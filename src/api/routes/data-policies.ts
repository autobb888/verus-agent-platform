import { safeJsonParse } from '../../utils/safe-json.js';
/**
 * Data Handling Policies & Deletion Attestation API (Phase 6g)
 * 
 * Agents declare data handling policies. Buyers set preferences on jobs.
 * After job completion, agents sign deletion attestations.
 * 
 * Endpoints:
 * - GET    /v1/agents/:verusId/data-policy     — Get agent's data policy
 * - PUT    /v1/me/data-policy                   — Set/update my data policy
 * - GET    /v1/jobs/:id/data-terms              — Get job data handling terms
 * - POST   /v1/jobs/:id/deletion-attestation    — Sign deletion attestation (seller)
 * - GET    /v1/jobs/:id/deletion-attestation    — Get attestation for a job
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getSessionFromRequest } from './auth.js';
import { getDatabase, jobQueries } from '../../db/index.js';
import { createNotification } from './notifications.js';
import { emitWebhookEvent } from '../../notifications/webhook-engine.js';
import { z } from 'zod';
import { randomUUID } from 'crypto';

// --- Schemas ---

const dataPolicySchema = z.object({
  retention: z.enum(['none', 'job-duration', '30-days', 'permanent']),
  allowTraining: z.boolean(),
  allowThirdParty: z.boolean(),
  deletionAttestationSupported: z.boolean(),
  modelInfo: z.object({
    provider: z.string().max(100).optional(),
    model: z.string().max(100).optional(),
    hosting: z.enum(['self-hosted', 'cloud', 'undisclosed']).optional(),
  }).optional(),
});

const dataTermsSchema = z.object({
  retention: z.enum(['none', 'job-duration', '30-days']),
  allowTraining: z.boolean(),
  allowThirdParty: z.boolean(),
  requireDeletionAttestation: z.boolean(),
});

const deletionAttestationSchema = z.object({
  signature: z.string().min(1).max(500),
  timestamp: z.number(),
});

/**
 * Generate the canonical deletion attestation message.
 * Must match exactly what the frontend tells the seller to sign.
 */
function generateAttestationMessage(jobHash: string, timestamp: number): string {
  return `VAP-DELETE|Job:${jobHash}|Ts:${timestamp}|I attest that all buyer-provided data, conversation history, and generated artifacts for this job have been deleted from my systems. This is a binding commitment under the platform terms of service.`;
}

async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
  }
  (request as any).session = session;
}

function isJobParticipant(job: any, verusId: string): boolean {
  return job.buyer_verus_id === verusId || job.seller_verus_id === verusId;
}

export async function dataPolicyRoutes(fastify: FastifyInstance): Promise<void> {

  /**
   * GET /v1/agents/:verusId/data-policy — Agent's declared data policy (public)
   */
  fastify.get('/v1/agents/:verusId/data-policy', async (request, reply) => {
    const { verusId } = request.params as { verusId: string };
    const db = getDatabase();

    const policy = db.prepare(`SELECT * FROM agent_data_policies WHERE agent_verus_id = ?`).get(verusId) as any;
    if (!policy) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'No data policy declared' } });
    }

    return {
      data: {
        agentVerusId: policy.agent_verus_id,
        retention: policy.retention,
        allowTraining: policy.allow_training === 1,
        allowThirdParty: policy.allow_third_party === 1,
        deletionAttestationSupported: policy.deletion_attestation_supported === 1,
        modelInfo: safeJsonParse(policy.model_info),
        updatedAt: policy.updated_at,
      },
    };
  });

  /**
   * PUT /v1/me/data-policy — Set/update my data handling policy
   */
  fastify.put('/v1/me/data-policy', {
    preHandler: requireAuth,
    config: { rateLimit: { max: 10, timeWindow: 60_000 } },
  }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };

    const parsed = dataPolicySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid policy data', details: parsed.error.errors },
      });
    }

    const db = getDatabase();
    const existing = db.prepare(`SELECT id FROM agent_data_policies WHERE agent_verus_id = ?`).get(session.verusId) as any;

    if (existing) {
      db.prepare(`
        UPDATE agent_data_policies SET
          retention = ?, allow_training = ?, allow_third_party = ?,
          deletion_attestation_supported = ?, model_info = ?,
          updated_at = datetime('now')
        WHERE agent_verus_id = ?
      `).run(
        parsed.data.retention,
        parsed.data.allowTraining ? 1 : 0,
        parsed.data.allowThirdParty ? 1 : 0,
        parsed.data.deletionAttestationSupported ? 1 : 0,
        parsed.data.modelInfo ? JSON.stringify(parsed.data.modelInfo) : null,
        session.verusId,
      );
    } else {
      db.prepare(`
        INSERT INTO agent_data_policies (id, agent_verus_id, retention, allow_training, allow_third_party, deletion_attestation_supported, model_info)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        session.verusId,
        parsed.data.retention,
        parsed.data.allowTraining ? 1 : 0,
        parsed.data.allowThirdParty ? 1 : 0,
        parsed.data.deletionAttestationSupported ? 1 : 0,
        parsed.data.modelInfo ? JSON.stringify(parsed.data.modelInfo) : null,
      );
    }

    return { data: { success: true } };
  });

  /**
   * GET /v1/jobs/:id/data-terms — Get data handling terms for a job
   */
  fastify.get('/v1/jobs/:id/data-terms', { preHandler: requireAuth }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const { id } = request.params as { id: string };

    const job = jobQueries.getById(id);
    if (!job || !isJobParticipant(job, session.verusId)) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
    }

    const db = getDatabase();
    const terms = db.prepare(`SELECT * FROM job_data_terms WHERE job_id = ?`).get(id) as any;

    const attestation = db.prepare(`SELECT * FROM deletion_attestations WHERE job_id = ?`).get(id) as any;

    return {
      data: {
        terms: terms ? {
          retention: terms.retention,
          allowTraining: terms.allow_training === 1,
          allowThirdParty: terms.allow_third_party === 1,
          requireDeletionAttestation: terms.require_deletion_attestation === 1,
          acceptedBySeller: terms.accepted_by_seller === 1,
          acceptedAt: terms.accepted_at,
        } : null,
        attestation: attestation ? {
          signed: true,
          scope: attestation.scope,
          signedAt: attestation.created_at,
          verified: attestation.signature_verified === 1,
        } : null,
        jobStatus: job.status,
      },
    };
  });

  /**
   * POST /v1/jobs/:id/deletion-attestation — Sign deletion attestation
   * 
   * Only seller can sign. Job must be completed.
   * This is a LEGAL commitment — not a technical guarantee.
   */
  fastify.post('/v1/jobs/:id/deletion-attestation', {
    preHandler: requireAuth,
    config: { rateLimit: { max: 10, timeWindow: 60_000 } },
  }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const { id } = request.params as { id: string };

    const job = jobQueries.getById(id);
    if (!job) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
    }

    // Only seller signs attestation
    if (job.seller_verus_id !== session.verusId) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Only the seller can sign deletion attestation' } });
    }

    // Job must be completed
    if (job.status !== 'completed') {
      return reply.code(400).send({ error: { code: 'JOB_NOT_COMPLETED', message: 'Job must be completed before deletion attestation' } });
    }

    // Check if terms require it
    const db = getDatabase();
    const terms = db.prepare(`SELECT * FROM job_data_terms WHERE job_id = ?`).get(id) as any;

    const parsed = deletionAttestationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid attestation', details: parsed.error.errors },
      });
    }

    // Generate canonical message and verify signature
    const attestationMessage = generateAttestationMessage(job.job_hash, parsed.data.timestamp);
    let signatureVerified = 0;
    try {
      const { getRpcClient } = await import('../../indexer/rpc-client.js');
      const rpc = getRpcClient();
      const result = await rpc.verifyMessage(session.verusId, attestationMessage, parsed.data.signature);
      signatureVerified = result ? 1 : 0;
    } catch (err) {
      console.error('[DataPolicy] Signature verification failed:', err);
    }

    // Check for existing attestation
    const existing = db.prepare(`SELECT id FROM deletion_attestations WHERE job_id = ?`).get(id) as any;
    if (existing) {
      return reply.code(409).send({ error: { code: 'ALREADY_ATTESTED', message: 'Deletion attestation already signed for this job' } });
    }

    const attestationId = randomUUID();
    const scope = 'All buyer-provided data, conversation history, and generated artifacts have been deleted.';
    db.prepare(`
      INSERT INTO deletion_attestations (id, job_id, agent_verus_id, signature, message, scope, signature_verified)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      attestationId, id, session.verusId,
      parsed.data.signature, attestationMessage, scope,
      signatureVerified,
    );

    // Notify buyer
    createNotification({
      recipientVerusId: job.buyer_verus_id,
      type: 'deletion.attested',
      title: 'Data Deletion Attested',
      body: 'The seller has signed a deletion attestation for your job data',
      jobId: id,
    });

    emitWebhookEvent({
      type: 'job.completed' as any, // Reuse closest event type
      agentVerusId: job.buyer_verus_id,
      jobId: id,
      data: { event: 'deletion_attested', signatureVerified: signatureVerified === 1 },
    });

    return reply.code(201).send({
      data: {
        id: attestationId,
        signatureVerified: signatureVerified === 1,
        note: 'This attestation is a legal and reputational commitment. It is not a technical guarantee of data deletion.',
      },
    });
  });

  /**
   * GET /v1/jobs/:id/deletion-attestation — Get attestation details
   */
  fastify.get('/v1/jobs/:id/deletion-attestation', { preHandler: requireAuth }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const { id } = request.params as { id: string };

    const job = jobQueries.getById(id);
    if (!job || !isJobParticipant(job, session.verusId)) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
    }

    const db = getDatabase();
    const attestation = db.prepare(`SELECT * FROM deletion_attestations WHERE job_id = ?`).get(id) as any;

    if (!attestation) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'No deletion attestation found' } });
    }

    return {
      data: {
        id: attestation.id,
        jobId: attestation.job_id,
        agentVerusId: attestation.agent_verus_id,
        scope: attestation.scope,
        signatureVerified: attestation.signature_verified === 1,
        createdAt: attestation.created_at,
        note: 'Deletion attestation is a signed legal commitment. Fail on spot-check = strong evidence of violation. Pass on spot-check ≠ proof of deletion.',
      },
    };
  });

  /**
   * GET /v1/jobs/:id/deletion-attestation/message — Get the message to sign
   */
  fastify.get('/v1/jobs/:id/deletion-attestation/message', { preHandler: requireAuth }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, string>;
    const now = Math.floor(Date.now() / 1000);
    const rawTs = parseInt(query.timestamp || String(now), 10);
    const timestamp = Number.isFinite(rawTs) && rawTs > now - 600 && rawTs < now + 300 ? rawTs : now;

    const job = jobQueries.getById(id);
    if (!job || job.seller_verus_id !== session.verusId) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
    }

    return {
      data: {
        message: generateAttestationMessage(job.job_hash, timestamp),
        timestamp,
      },
    };
  });
}
