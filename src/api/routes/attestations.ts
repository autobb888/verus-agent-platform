import { safeJsonParse } from '../../utils/safe-json.js';
/**
 * Attestation Routes
 * 
 * POST /v1/me/attestations              — Submit a deletion attestation (auth required)
 * GET  /v1/agents/:agentId/attestations  — Get attestations for an agent (public)
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getDatabase } from '../../db/index.js';
import { getSessionFromRequest } from './auth.js';
import { agentQueries } from '../../db/index.js';
import { getRpcClient } from '../../indexer/rpc-client.js';

// ────────────────────────────────────────────
// Auth helper
// ────────────────────────────────────────────

async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return reply.code(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  }
  (request as any).session = session;
}

// ────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────

const attestationSchema = z.object({
  jobId: z.string().min(1).max(200),
  containerId: z.string().min(1).max(200),
  createdAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T/, 'Must be ISO 8601 datetime'),
  destroyedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T/, 'Must be ISO 8601 datetime'),
  dataVolumes: z.array(z.string()).default([]),
  deletionMethod: z.string().min(1).max(200),
  attestedBy: z.string().min(1).max(200),
  signature: z.string().min(1),
});

export async function attestationRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDatabase();

  // Prepared statements
  const insertAttestation = db.prepare(`
    INSERT INTO attestations (id, agent_id, job_id, container_id, created_at, destroyed_at, data_volumes, deletion_method, attested_by, signature)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getByAgentId = db.prepare(`
    SELECT * FROM attestations WHERE agent_id = ? ORDER BY submitted_at DESC LIMIT ? OFFSET ?
  `);

  const getByAttestedBy = db.prepare(`
    SELECT * FROM attestations WHERE attested_by = ? ORDER BY submitted_at DESC LIMIT ? OFFSET ?
  `);

  const countByAttestedBy = db.prepare(`
    SELECT COUNT(*) as count FROM attestations WHERE attested_by = ?
  `);

  // ────────────────────────────────────────────
  // POST /v1/me/attestations — Submit attestation
  // ────────────────────────────────────────────

  fastify.post('/v1/me/attestations', { preHandler: requireAuth }, async (request, reply) => {
    const session = (request as any).session;

    // Validate body
    const parsed = attestationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid attestation data',
          details: parsed.error.issues,
        },
      });
    }

    const data = parsed.data;

    // Verify the attestedBy matches the authenticated identity
    if (data.attestedBy !== session.verusId && data.attestedBy !== session.identityName) {
      return reply.code(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'attestedBy must match your authenticated identity',
        },
      });
    }

    // Verify the signature cryptographically via Verus RPC
    const payload = {
      attestedBy: data.attestedBy,
      containerId: data.containerId,
      createdAt: data.createdAt,
      dataVolumes: data.dataVolumes,
      deletionMethod: data.deletionMethod,
      destroyedAt: data.destroyedAt,
      jobId: data.jobId,
    };
    const canonical = JSON.stringify(payload, Object.keys(payload).sort());

    try {
      const rpc = getRpcClient();
      const verifyResult = await rpc.verifyMessage(data.attestedBy, canonical, data.signature);
      if (verifyResult !== true) {
        return reply.code(400).send({
          error: { code: 'INVALID_SIGNATURE', message: 'Attestation signature verification failed' },
        });
      }
    } catch (err: any) {
      return reply.code(400).send({
        error: { code: 'SIGNATURE_VERIFY_ERROR', message: 'Could not verify attestation signature' },
      });
    }

    // Verify jobId belongs to this agent (if it references a platform job)
    if (data.jobId) {
      const job = db.prepare('SELECT seller_verus_id FROM jobs WHERE id = ?').get(data.jobId) as { seller_verus_id: string } | undefined;
      if (job && job.seller_verus_id !== session.verusId) {
        return reply.code(403).send({
          error: { code: 'NOT_YOUR_JOB', message: 'Job does not belong to you' },
        });
      }
    }

    // Look up agent
    const agent = agentQueries.getById(session.verusId);
    const agentId = agent?.id || session.verusId;

    const id = randomUUID();

    try {
      insertAttestation.run(
        id,
        agentId,
        data.jobId,
        data.containerId,
        data.createdAt,
        data.destroyedAt,
        JSON.stringify(data.dataVolumes),
        data.deletionMethod,
        data.attestedBy,
        data.signature,
      );
    } catch (err: any) {
      return reply.code(500).send({
        error: {
          code: 'DB_ERROR',
          message: 'Failed to store attestation',
        },
      });
    }

    return reply.code(201).send({ id, status: 'submitted' });
  });

  // ────────────────────────────────────────────
  // GET /v1/agents/:agentId/attestations — Public
  // ────────────────────────────────────────────

  fastify.get('/v1/agents/:agentId/attestations', async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const q = request.query as Record<string, string>;
    const limit = Math.min(Math.max(parseInt(q.limit || '20', 10) || 20, 1), 100);
    const offset = Math.max(parseInt(q.offset || '0', 10) || 0, 0);

    // Try by internal agent ID first, then by VerusID (attested_by)
    let rows = getByAgentId.all(agentId, limit, offset) as any[];
    let total: number;

    if (rows.length === 0) {
      // Try looking up by VerusID
      rows = getByAttestedBy.all(agentId, limit, offset) as any[];
      total = (countByAttestedBy.get(agentId) as { count: number }).count;
    } else {
      // Count for the agent_id query
      total = (db.prepare('SELECT COUNT(*) as count FROM attestations WHERE agent_id = ?').get(agentId) as { count: number }).count;
    }

    const attestations = rows.map(row => ({
      id: row.id,
      jobId: row.job_id,
      containerId: row.container_id,
      createdAt: row.created_at,
      destroyedAt: row.destroyed_at,
      dataVolumes: safeJsonParse(row.data_volumes, []),
      deletionMethod: row.deletion_method,
      attestedBy: row.attested_by,
      signature: row.signature,
      submittedAt: row.submitted_at,
    }));

    return {
      data: attestations,
      meta: {
        total,
        limit,
        offset,
        hasMore: offset + attestations.length < total,
      },
    };
  });
}
