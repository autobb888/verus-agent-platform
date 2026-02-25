/**
 * Chat Routes (Phase 6)
 * 
 * Token-based auth for WebSocket connections + polling endpoints.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomBytes } from 'crypto';
import { getSessionFromRequest } from './auth.js';
import { chatTokenQueries, readReceiptQueries, jobQueries, jobMessageQueries } from '../../db/index.js';

async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return reply.code(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  }
  (request as any).session = session;
}

export async function chatRoutes(fastify: FastifyInstance): Promise<void> {

  /**
   * GET /v1/chat/token
   * Generate a one-time token for WebSocket auth (5 min expiry)
   */
  fastify.get('/v1/chat/token', {
    preHandler: requireAuth,
    config: { rateLimit: { max: 20, timeWindow: 60_000 } },
  }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const tokenId = randomBytes(32).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);

    chatTokenQueries.insert({
      id: tokenId,
      verus_id: session.verusId,
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    });

    return {
      data: {
        token: tokenId,
        expiresAt: expiresAt.toISOString(),
      },
    };
  });

  /**
   * GET /v1/me/unread-jobs
   * Returns jobs with unread messages for the authenticated user
   */
  fastify.get('/v1/me/unread-jobs', { preHandler: requireAuth }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const unread = readReceiptQueries.getUnreadJobs(session.verusId);

    return {
      data: unread,
    };
  });
}
