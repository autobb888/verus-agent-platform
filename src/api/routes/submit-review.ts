/**
 * Review Submission API (Facilitator Pattern)
 * 
 * Buyers submit signed reviews which go to the agent's INBOX.
 * The agent then chooses to add them to their on-chain VerusID.
 * 
 * Flow:
 * 1. Buyer signs a review message
 * 2. Buyer submits to platform
 * 3. Platform verifies signature, puts in agent's inbox
 * 4. Agent views inbox, gets updateidentity command
 * 5. Agent runs command to add review to their VerusID
 * 6. Platform indexes the on-chain update
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { inboxQueries, agentQueries } from '../../db/index.js';
import { getRpcClient } from '../../indexer/rpc-client.js';
import { VDXF_KEYS, encodeVdxfValue } from '../../validation/vdxf-keys.js';
import { getIO } from '../../chat/ws-server.js';

import { RateLimiter } from '../../utils/rate-limiter.js';

// P3-RATE-1: Rate limiting for review submissions
const ipReviewLimiter = new RateLimiter(60 * 1000, 10);    // 10 reviews/min per IP
const buyerReviewLimiter = new RateLimiter(60 * 1000, 5);  // 5 reviews/min per buyer

// Review submission schema
const submitReviewSchema = z.object({
  agentVerusId: z.string().min(1).max(100),     // Agent being reviewed (i-address or name@)
  buyerVerusId: z.string().min(1).max(100),     // Buyer leaving review (i-address or name@)
  jobHash: z.string().min(1).max(100),          // Unique job identifier
  message: z.string().max(1000).optional(),     // Review text
  rating: z.number().min(1).max(5).optional(),  // 1-5 stars
  timestamp: z.number(),                         // Unix timestamp (seconds)
  signature: z.string().min(1).max(500),        // Buyer's signature
});

/**
 * Generate the message that should have been signed
 * This must match exactly what the buyer signed
 */
function generateReviewMessage(
  agentVerusId: string,
  jobHash: string,
  message: string | undefined,
  rating: number | undefined,
  timestamp: number
): string {
  return [
    'Verus Agent Platform Review',
    '===========================',
    `Agent: ${agentVerusId}`,
    `Job: ${jobHash}`,
    `Rating: ${rating || 'N/A'}`,
    `Message: ${message || 'No message'}`,
    `Timestamp: ${timestamp}`,
    '',
    'I confirm this review is genuine.',
  ].join('\n');
}

/**
 * Generate VDXF data for storing the review in contentmultimap
 */
function generateVdxfData(
  buyerVerusId: string,
  jobHash: string,
  message: string | undefined,
  rating: number | undefined,
  signature: string,
  timestamp: number
): Record<string, unknown> {
  const reviewKeys = VDXF_KEYS.review;
  
  return {
    [reviewKeys.buyer]: encodeVdxfValue(buyerVerusId),
    [reviewKeys.jobHash]: encodeVdxfValue(jobHash),
    [reviewKeys.message]: message ? encodeVdxfValue(message) : null,
    [reviewKeys.rating]: rating ? encodeVdxfValue(rating) : null,
    [reviewKeys.signature]: encodeVdxfValue(signature),
    [reviewKeys.timestamp]: encodeVdxfValue(timestamp),
  };
}

export async function submitReviewRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /v1/reviews
   * Submit a signed review → goes to agent's inbox
   */
  fastify.post('/v1/reviews', async (request: FastifyRequest, reply: FastifyReply) => {
    // P3-RATE-1: Check IP rate limit first
    const clientIp = request.ip;
    if (!ipReviewLimiter.check(clientIp)) {
      return reply.code(429).send({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many review submissions. Please wait before trying again.',
        },
      });
    }

    // Validate input
    const parsed = submitReviewSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid review data',
          details: parsed.error.errors,
        },
      });
    }

    const { agentVerusId, buyerVerusId, jobHash, message, rating, timestamp, signature } = parsed.data;

    // Check timestamp is reasonable (within last 24 hours)
    const now = Math.floor(Date.now() / 1000);
    const maxAge = 24 * 60 * 60; // 24 hours
    if (timestamp < now - maxAge || timestamp > now + 300) {
      return reply.code(400).send({
        error: {
          code: 'INVALID_TIMESTAMP',
          message: 'Timestamp must be within the last 24 hours',
        },
      });
    }

    const rpc = getRpcClient();
    
    // Resolve agent's identity address
    let agentIAddress: string;
    try {
      // Check if it's already an i-address or needs resolution
      const agent = agentQueries.getById(agentVerusId);
      if (agent) {
        agentIAddress = agent.verus_id;
      } else {
        const agentIdentity = await rpc.getIdentity(agentVerusId);
        agentIAddress = agentIdentity.identity.identityaddress;
        // Verify agent is registered
        const resolvedAgent = agentQueries.getById(agentIAddress);
        if (!resolvedAgent) {
          return reply.code(404).send({
            error: {
              code: 'AGENT_NOT_FOUND',
              message: 'Agent not found in platform registry',
            },
          });
        }
      }
    } catch {
      return reply.code(404).send({
        error: {
          code: 'AGENT_NOT_FOUND',
          message: 'Could not resolve agent identity',
        },
      });
    }

    // Resolve buyer's identity address
    let buyerIAddress: string;
    try {
      const buyerIdentity = await rpc.getIdentity(buyerVerusId);
      buyerIAddress = buyerIdentity.identity.identityaddress;
    } catch {
      return reply.code(400).send({
        error: {
          code: 'INVALID_BUYER',
          message: 'Could not resolve buyer identity',
        },
      });
    }

    // P3-RATE-1: Check buyer-specific rate limit
    if (!buyerReviewLimiter.check(buyerIAddress)) {
      return reply.code(429).send({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many reviews submitted by this identity. Please wait.',
        },
      });
    }

    // P3-DUP-1: Check for duplicate pending review
    const existingReview = inboxQueries.findPendingReview(agentIAddress, buyerIAddress, jobHash);
    if (existingReview) {
      return reply.code(409).send({
        error: {
          code: 'DUPLICATE_REVIEW',
          message: 'A review for this job is already pending in the agent inbox.',
        },
      });
    }

    // Verify the buyer's signature — try identity name first (required for CIdentitySignature)
    const expectedMessage = generateReviewMessage(agentVerusId, jobHash, message, rating, timestamp);

    // Build candidate list: FQN first, then identity name variants, then i-address
    const candidates: string[] = [];
    try {
      const buyerIdentityFull = await rpc.getIdentity(buyerVerusId);
      const fqn = (buyerIdentityFull as any).fullyqualifiedname;
      if (fqn) candidates.push(fqn);
      const idObj = buyerIdentityFull?.identity;
      if (idObj?.name && idObj?.parent) {
        try {
          const parentIdentity = await rpc.getIdentity(idObj.parent);
          const parentName = (parentIdentity as any).fullyqualifiedname || parentIdentity?.identity?.name;
          if (parentName) candidates.push(`${idObj.name}.${parentName.replace(/@$/, '')}@`);
        } catch {
          candidates.push(`${idObj.name}@`);
        }
      }
      if (Array.isArray(idObj?.primaryaddresses)) candidates.push(...idObj.primaryaddresses);
      if (idObj?.identityaddress) candidates.push(idObj.identityaddress);
    } catch { /* resolution failed, fall through */ }
    if (buyerVerusId.endsWith('@')) candidates.push(buyerVerusId);
    else candidates.push(buyerVerusId, `${buyerVerusId}@`);
    candidates.push(buyerIAddress);

    let isValid = false;
    for (const target of [...new Set(candidates.filter(Boolean))]) {
      try {
        if (await rpc.verifyMessage(target, expectedMessage, signature)) {
          isValid = true;
          break;
        }
      } catch { /* try next */ }
    }

    if (!isValid) {
      fastify.log.warn({ buyerVerusId, buyerIAddress, jobHash, candidates: [...new Set(candidates.filter(Boolean))] }, 'Invalid review signature');
      return reply.code(401).send({
        error: {
          code: 'INVALID_SIGNATURE',
          message: 'Signature verification failed. Make sure you signed the exact message format.',
        },
      });
    }

    // Generate VDXF data for the agent to add to their identity
    const vdxfData = generateVdxfData(buyerIAddress, jobHash, message, rating, signature, timestamp);

    // Calculate expiry (7 days)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // Add to agent's inbox
    const inboxId = inboxQueries.insert({
      recipient_verus_id: agentIAddress,
      type: 'review',
      sender_verus_id: buyerIAddress,
      job_hash: jobHash,
      rating: rating || null,
      message: message || null,
      signature,
      status: 'pending',
      expires_at: expiresAt,
      vdxf_data: JSON.stringify(vdxfData),
    });

    fastify.log.info({
      inboxId,
      agentVerusId: agentIAddress,
      buyerVerusId: buyerIAddress,
      jobHash,
      rating,
    }, 'Review added to agent inbox');

    // Notify agent in real-time via WebSocket (user-level room)
    const ioReview = getIO();
    if (ioReview) {
      ioReview.to(`user:${agentIAddress}`).emit('review_received', {
        inboxId,
        jobHash,
        rating: rating || null,
        buyerVerusId: buyerIAddress,
      });
    }

    return reply.code(201).send({
      data: {
        inboxId,
        status: 'pending',
        message: 'Review verified and added to agent inbox. Agent must add it to their VerusID.',
        agentVerusId: agentIAddress,
        buyerVerusId: buyerIAddress,
        jobHash,
        rating,
        expiresAt,
      },
    });
  });

  /**
   * GET /v1/reviews/message
   * Get the message format that needs to be signed for a review
   * (Helper endpoint for clients)
   */
  fastify.get('/v1/reviews/message', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, string>;
    
    const agentVerusId = query.agentVerusId;
    const jobHash = query.jobHash;
    const message = query.message;
    const rating = query.rating ? parseInt(query.rating, 10) : undefined;
    const timestamp = query.timestamp ? parseInt(query.timestamp, 10) : Math.floor(Date.now() / 1000);

    if (!agentVerusId || !jobHash) {
      return reply.code(400).send({
        error: {
          code: 'MISSING_PARAMS',
          message: 'agentVerusId and jobHash are required',
        },
      });
    }

    const reviewMessage = generateReviewMessage(agentVerusId, jobHash, message, rating, timestamp);

    return {
      data: {
        message: reviewMessage,
        timestamp,
        instructions: [
          '1. Copy the message above',
          '2. Sign it with: verus -testnet signmessage "yourID@" "<message>"',
          '3. Submit the signature to POST /v1/reviews',
        ],
      },
    };
  });
}
