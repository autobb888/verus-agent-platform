/**
 * Inbox API Routes
 * 
 * Agents can view pending items (reviews, messages) that are waiting
 * for them to add to their on-chain VerusID.
 * 
 * Flow:
 * 1. Buyer submits review → goes to agent's inbox
 * 2. Agent views inbox → sees pending review with VDXF formatting
 * 3. Agent copies updateidentity command → runs it themselves
 * 4. Platform detects on-chain update → clears inbox item
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getSessionFromRequest } from './auth.js';
import { inboxQueries, agentQueries, jobQueries } from '../../db/index.js';
import { VDXF_KEYS, encodeVdxfValue } from '../../validation/vdxf-keys.js';
import { getRpcClient } from '../../indexer/rpc-client.js';

import { safeJsonParse } from '../../utils/safe-json.js';

// Auth middleware
async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return reply.code(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  }
  (request as any).session = session;
}

export async function inboxRoutes(fastify: FastifyInstance): Promise<void> {
  // All routes require authentication
  fastify.addHook('preHandler', requireAuth);

  /**
   * GET /v1/me/inbox
   * Get pending inbox items for the logged-in agent
   */
  fastify.get('/v1/me/inbox', async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const query = request.query as Record<string, string>;
    
    const status = query.status || 'pending';
    const limit = Math.min(parseInt(query.limit || '20', 10) || 20, 100);
    const offset = Math.max(parseInt(query.offset || '0', 10) || 0, 0);

    const items = inboxQueries.getByRecipient(session.verusId, status, limit, offset);
    const pendingCount = inboxQueries.countPending(session.verusId);

    return {
      data: items.map(item => {
        // For job-related items, include job description
        let jobDescription = null;
        if (item.vdxf_data) {
          const vdxf = safeJsonParse(item.vdxf_data);
          if (vdxf?.jobId) {
            const job = jobQueries.getById(vdxf.jobId);
            if (job) jobDescription = job.description;
          }
        }
        return {
          id: item.id,
          type: item.type,
          senderVerusId: item.sender_verus_id,
          jobHash: item.job_hash,
          rating: item.rating,
          message: item.message,
          jobDescription,
          status: item.status,
          createdAt: item.created_at,
          expiresAt: item.expires_at,
          vdxfData: safeJsonParse(item.vdxf_data),
        };
      }),
      meta: {
        pendingCount,
        limit,
        offset,
      },
    };
  });

  /**
   * GET /v1/me/inbox/:id
   * Get a specific inbox item with full details and update command
   */
  fastify.get('/v1/me/inbox/:id', async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const { id } = request.params as { id: string };

    const item = inboxQueries.getById(id);
    if (!item) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Inbox item not found' },
      });
    }

    // Verify ownership
    if (item.recipient_verus_id !== session.verusId) {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'Not your inbox item' },
      });
    }

    // Get agent's friendly name for the command
    const agent = agentQueries.getById(session.verusId);
    const agentName = agent?.name || session.verusId;

    // Generate the appropriate command
    const updateCommand = generateUpdateIdentityCommand(agentName, item);

    // For job notifications, include job details for the sign flow
    let jobDetails = null;
    if (item.vdxf_data) {
      const vdxf = safeJsonParse(item.vdxf_data);
      if (vdxf?.jobId) {
        const job = jobQueries.getById(vdxf.jobId);
        if (job) {
          jobDetails = {
            id: job.id,
            jobHash: job.job_hash,
            buyerVerusId: job.buyer_verus_id,
            sellerVerusId: job.seller_verus_id,
            amount: job.amount,
            currency: job.currency,
            description: job.description,
            status: job.status,
            paymentTerms: job.payment_terms,
            paymentTxid: job.payment_txid,
            paymentVerified: job.payment_verified === 1,
            signatures: {
              request: job.request_signature ? '✓ Signed' : null,
              acceptance: job.acceptance_signature ? '✓ Signed' : null,
              delivery: job.delivery_signature ? '✓ Signed' : null,
              completion: job.completion_signature ? '✓ Signed' : null,
            },
            timestamps: {
              requested: job.requested_at,
              accepted: job.accepted_at,
              delivered: job.delivered_at,
              completed: job.completed_at,
            },
            deliveryHash: job.delivery_hash,
          };
        }
      }
    }

    return {
      data: {
        id: item.id,
        type: item.type,
        senderVerusId: item.sender_verus_id,
        jobHash: item.job_hash,
        rating: item.rating,
        message: item.message,
        signature: item.signature,
        status: item.status,
        createdAt: item.created_at,
        expiresAt: item.expires_at,
        vdxfData: safeJsonParse(item.vdxf_data),
        updateCommand,
        jobDetails,
      },
    };
  });

  /**
   * POST /v1/me/inbox/:id/reject
   * Reject an inbox item (don't want to add to identity)
   */
  fastify.post('/v1/me/inbox/:id/reject', {
    config: { rateLimit: { max: 20, timeWindow: 60_000 } },
  }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const { id } = request.params as { id: string };

    const item = inboxQueries.getById(id);
    if (!item) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Inbox item not found' },
      });
    }

    if (item.recipient_verus_id !== session.verusId) {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'Not your inbox item' },
      });
    }

    if (item.status !== 'pending') {
      return reply.code(400).send({
        error: { code: 'ALREADY_PROCESSED', message: 'Item already processed' },
      });
    }

    inboxQueries.updateStatus(id, 'rejected');

    return { data: { success: true, status: 'rejected' } };
  });

  /**
   * POST /v1/me/inbox/:id/accept
   * Accept an inbox item (agent has added it to their identity)
   */
  fastify.post('/v1/me/inbox/:id/accept', {
    config: { rateLimit: { max: 20, timeWindow: 60_000 } },
  }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const { id } = request.params as { id: string };
    const { txid } = (request.body || {}) as { txid?: string };

    const item = inboxQueries.getById(id);
    if (!item) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Inbox item not found' },
      });
    }

    if (item.recipient_verus_id !== session.verusId) {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'Not your inbox item' },
      });
    }

    if (item.status !== 'pending') {
      return reply.code(400).send({
        error: { code: 'ALREADY_PROCESSED', message: 'Item already processed' },
      });
    }

    inboxQueries.updateStatus(id, 'accepted');

    return { data: { success: true, status: 'accepted', txid: txid || null } };
  });

  /**
   * GET /v1/me/inbox/count
   * Get count of pending inbox items
   */
  fastify.get('/v1/me/inbox/count', async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const count = inboxQueries.countPending(session.verusId);
    return { data: { pending: count } };
  });

  /**
   * GET /v1/me/identity/raw
   * Returns the agent's current on-chain identity data + previous identity UTXO
   * Used by SDK for offline identity update transaction building
   */
  fastify.get('/v1/me/identity/raw', {
    config: { rateLimit: { max: 10, timeWindow: 60_000 } },
  }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const rpc = getRpcClient();

    try {
      const identity = await rpc.getIdentity(session.verusId);
      if (!identity?.identity) {
        return reply.code(404).send({
          error: { code: 'IDENTITY_NOT_FOUND', message: 'Identity not found on chain' },
        });
      }

      // Get the identity transaction to find the previous output (needed for spending)
      let prevOutput = null;
      if (identity.txid) {
        try {
          const tx = await rpc.rpcCall<{
            txid: string;
            vout: Array<{ value: number; n: number; scriptPubKey: { hex: string; type: string; identityprimary?: unknown } }>;
          }>('getrawtransaction', [identity.txid, 1]);

          // Use vout from getidentity response if available, otherwise search
          const searchVout = identity.vout != null ? identity.vout : undefined;

          for (const vout of tx.vout || []) {
            const isIdentityOutput = searchVout != null
              ? vout.n === searchVout
              : (vout.scriptPubKey?.identityprimary !== undefined || vout.scriptPubKey?.type === 'identity_primary');

            if (isIdentityOutput) {
              prevOutput = {
                txid: identity.txid,
                vout: vout.n,
                scriptHex: vout.scriptPubKey.hex,
                value: vout.value,
              };
              break;
            }
          }
        } catch (txErr) {
          fastify.log.warn({ txid: identity.txid, error: txErr }, 'Could not fetch identity tx');
        }
      }

      // Get chain info for tx building
      const info = await rpc.rpcCall<{ blocks: number }>('getinfo');

      return {
        data: {
          identity: identity.identity,
          txid: identity.txid || null,
          blockHeight: info.blocks,
          prevOutput,
        },
      };
    } catch (error) {
      fastify.log.error({ error, verusId: session.verusId }, 'Failed to fetch raw identity');
      return reply.code(502).send({
        error: { code: 'RPC_ERROR', message: 'Failed to fetch identity from chain' },
      });
    }
  });
}

/**
 * Generate the verus updateidentity command for an inbox item
 */
function generateUpdateIdentityCommand(agentName: string, item: any): string {
  if (item.type !== 'review') {
    return '# Command generation not yet supported for this type';
  }

  // Build the contentmultimap additions for the review
  const reviewKeys = VDXF_KEYS.review;
  
  const contentmultimap: Record<string, string[]> = {};
  
  if (item.sender_verus_id) {
    contentmultimap[reviewKeys.buyer] = [encodeVdxfValue(item.sender_verus_id)];
  }
  if (item.job_hash) {
    contentmultimap[reviewKeys.jobHash] = [encodeVdxfValue(item.job_hash)];
  }
  if (item.message) {
    contentmultimap[reviewKeys.message] = [encodeVdxfValue(item.message)];
  }
  if (item.rating) {
    contentmultimap[reviewKeys.rating] = [encodeVdxfValue(item.rating)];
  }
  if (item.signature) {
    contentmultimap[reviewKeys.signature] = [encodeVdxfValue(item.signature)];
  }
  
  const timestamp = Math.floor(Date.now() / 1000);
  contentmultimap[reviewKeys.timestamp] = [encodeVdxfValue(timestamp)];

  // Format the command
  const updateJson = {
    name: agentName,
    contentmultimap,
  };

  return `verus -testnet updateidentity '${JSON.stringify(updateJson)}'`;
}
