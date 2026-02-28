/**
 * Hold Queue Routes (Phase 6c)
 *
 * GET    /v1/jobs/:jobId/held-messages       — Get held messages for a job (sender only)
 * POST   /v1/jobs/:jobId/held-messages/:id/appeal — Appeal a held message
 * POST   /v1/jobs/:jobId/held-messages/:id/release — Release (admin/buyer review)
 * POST   /v1/jobs/:jobId/held-messages/:id/reject  — Reject (admin/buyer review)
 * GET    /v1/hold-queue/stats                — Hold queue stats (authenticated)
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getSessionFromRequest } from './auth.js';
import { jobQueries, jobMessageQueries, getDatabase } from '../../db/index.js';
import {
  getHeldMessages,
  appealMessage,
  releaseMessage,
  rejectMessage,
  getHoldQueueStats,
} from '../../chat/hold-queue.js';
import { getIO } from '../../chat/ws-server.js';
import { randomUUID } from 'crypto';

async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
  }
  return session;
}

const appealSchema = z.object({
  reason: z.string().min(1).max(2000),
});

export async function holdQueueRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /v1/jobs/:jobId/held-messages — Agent sees their own held messages
   */
  fastify.get('/v1/jobs/:jobId/held-messages', { preHandler: requireAuth }, async (request, reply) => {
    const session = getSessionFromRequest(request)!;
    const { jobId } = request.params as { jobId: string };

    const job = jobQueries.getById(jobId);
    if (!job) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
    }

    // Only job participants can see held messages
    if (job.buyer_verus_id !== session.verusId && job.seller_verus_id !== session.verusId) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Not a participant in this job' } });
    }

    const held = getHeldMessages(jobId, session.verusId);
    return { data: held };
  });

  /**
   * POST /v1/jobs/:jobId/held-messages/:id/appeal — Agent appeals a held message
   */
  fastify.post('/v1/jobs/:jobId/held-messages/:id/appeal', { preHandler: requireAuth }, async (request, reply) => {
    const session = getSessionFromRequest(request)!;
    const { jobId, id } = request.params as { jobId: string; id: string };

    const job = jobQueries.getById(jobId);
    if (!job) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
    }

    if (job.buyer_verus_id !== session.verusId && job.seller_verus_id !== session.verusId) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Not a participant in this job' } });
    }

    const body = request.body as Record<string, unknown>;
    const parsed = appealSchema.safeParse(body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'INVALID_BODY', message: parsed.error.message } });
    }

    const success = appealMessage(id, session.verusId, parsed.data.reason);
    if (!success) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Held message not found or already reviewed' } });
    }

    return { data: { status: 'appeal_submitted' } };
  });

  /**
   * POST /v1/jobs/:jobId/held-messages/:id/release — Release a held message (buyer review)
   */
  fastify.post('/v1/jobs/:jobId/held-messages/:id/release', { preHandler: requireAuth }, async (request, reply) => {
    const session = getSessionFromRequest(request)!;
    const { jobId, id } = request.params as { jobId: string; id: string };

    const job = jobQueries.getById(jobId);
    if (!job) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
    }

    // Only buyer can release held messages (they're the one at risk)
    if (job.buyer_verus_id !== session.verusId) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Only the buyer can release held messages' } });
    }

    const released = releaseMessage(id);
    if (!released) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Held message not found or already reviewed' } });
    }

    // T2-5 Fix: Insert released message into job_messages and broadcast via Socket.IO
    const messageId = randomUUID();
    const now = new Date().toISOString();
    const db = getDatabase();
    db.prepare(`
      INSERT INTO job_messages (id, job_id, sender_verus_id, content, signed, signature, safety_score, created_at)
      VALUES (?, ?, ?, ?, 0, NULL, ?, ?)
    `).run(messageId, jobId, released.sender_verus_id, released.content, released.safety_score, now);

    // Broadcast to job room via Socket.IO
    const io = getIO();
    if (io) {
      io.to(`job:${jobId}`).emit('message', {
        id: messageId,
        jobId,
        senderVerusId: released.sender_verus_id,
        content: released.content,
        safetyScore: released.safety_score,
        releasedFromHold: true,
        createdAt: now,
      });
    }

    return { data: { status: 'released', messageId } };
  });

  /**
   * POST /v1/jobs/:jobId/held-messages/:id/reject — Reject a held message (buyer review)
   */
  fastify.post('/v1/jobs/:jobId/held-messages/:id/reject', { preHandler: requireAuth }, async (request, reply) => {
    const session = getSessionFromRequest(request)!;
    const { jobId, id } = request.params as { jobId: string; id: string };

    const job = jobQueries.getById(jobId);
    if (!job) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
    }

    if (job.buyer_verus_id !== session.verusId) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Only the buyer can reject held messages' } });
    }

    const success = rejectMessage(id);
    if (!success) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Held message not found or already reviewed' } });
    }

    return { data: { status: 'rejected' } };
  });

  /**
   * GET /v1/hold-queue/stats — Hold queue statistics (authenticated)
   */
  fastify.get('/v1/hold-queue/stats', { preHandler: requireAuth }, async () => {
    const stats = getHoldQueueStats();
    return { data: stats };
  });
}
