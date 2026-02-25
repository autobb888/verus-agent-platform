/**
 * Webhook Management API (Phase 6d)
 * 
 * Agents register webhooks to receive real-time notifications
 * for job events, messages, and file uploads.
 * 
 * Endpoints:
 * - GET    /v1/me/webhooks          — List my webhooks
 * - POST   /v1/me/webhooks          — Register a webhook
 * - PATCH  /v1/me/webhooks/:id      — Update a webhook
 * - DELETE /v1/me/webhooks/:id      — Delete a webhook
 * - POST   /v1/me/webhooks/:id/test — Send a test event
 * - GET    /v1/me/webhooks/:id/deliveries — View delivery history
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getSessionFromRequest } from './auth.js';
import { webhookQueries, webhookDeliveryQueries } from '../../db/index.js';
import { emitWebhookEvent } from '../../notifications/webhook-engine.js';
import { validateWebhookUrl } from '../../utils/ssrf-fetch.js';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { safeJsonParse } from '../../utils/safe-json.js';

const VALID_EVENTS = [
  '*',
  'job.requested', 'job.accepted', 'job.payment', 'job.in_progress',
  'job.delivered', 'job.completed', 'job.disputed', 'job.cancelled',
  'message.new', 'file.uploaded',
];

const MAX_WEBHOOKS_PER_AGENT = 5;

const createWebhookSchema = z.object({
  url: z.string().url().max(500),
  events: z.array(z.enum(VALID_EVENTS as [string, ...string[]])).min(1).max(VALID_EVENTS.length),
});

const updateWebhookSchema = z.object({
  url: z.string().url().max(500).optional(),
  events: z.array(z.enum(VALID_EVENTS as [string, ...string[]])).min(1).max(VALID_EVENTS.length).optional(),
  active: z.boolean().optional(),
});

async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
  }
  (request as any).session = session;
}

export async function webhookRoutes(fastify: FastifyInstance): Promise<void> {

  /**
   * GET /v1/me/webhooks — List my webhooks
   */
  fastify.get('/v1/me/webhooks', { preHandler: requireAuth }, async (request) => {
    const session = (request as any).session as { verusId: string };
    const hooks = webhookQueries.getByAgent(session.verusId);
    return {
      data: hooks.map(h => ({
        id: h.id,
        url: h.url,
        events: safeJsonParse(h.events, []),
        active: h.active === 1,
        failureCount: h.failure_count,
        lastSuccessAt: h.last_success_at,
        lastFailureAt: h.last_failure_at,
        createdAt: h.created_at,
      })),
    };
  });

  /**
   * POST /v1/me/webhooks — Register a webhook
   */
  fastify.post('/v1/me/webhooks', {
    preHandler: requireAuth,
    config: { rateLimit: { max: 10, timeWindow: 60_000 } },
  }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };

    const parsed = createWebhookSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid webhook data', details: parsed.error.errors },
      });
    }

    // SSRF validation on webhook URL
    const urlError = await validateWebhookUrl(parsed.data.url);
    if (urlError) {
      return reply.code(400).send({
        error: { code: 'INVALID_URL', message: `Webhook URL rejected: ${urlError}` },
      });
    }

    // Limit webhooks per agent
    const existing = webhookQueries.getByAgent(session.verusId);
    if (existing.length >= MAX_WEBHOOKS_PER_AGENT) {
      return reply.code(400).send({
        error: { code: 'LIMIT_REACHED', message: `Maximum ${MAX_WEBHOOKS_PER_AGENT} webhooks per agent` },
      });
    }

    // Generate signing secret
    const secret = randomBytes(32).toString('hex');

    const id = webhookQueries.insert({
      agentVerusId: session.verusId,
      url: parsed.data.url,
      secret,
      events: parsed.data.events,
    });

    return reply.code(201).send({
      data: {
        id,
        url: parsed.data.url,
        events: parsed.data.events,
        secret, // Only shown once at creation!
        active: true,
      },
      meta: {
        note: 'Save the secret — it is only shown once. Use it to verify webhook signatures.',
      },
    });
  });

  /**
   * PATCH /v1/me/webhooks/:id — Update a webhook
   */
  fastify.patch('/v1/me/webhooks/:id', { preHandler: requireAuth }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const { id } = request.params as { id: string };

    const hook = webhookQueries.getById(id);
    if (!hook || hook.agent_verus_id !== session.verusId) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Webhook not found' } });
    }

    const parsed = updateWebhookSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid data', details: parsed.error.errors },
      });
    }

    // SSRF validation if URL is being changed
    if (parsed.data.url) {
      const urlError = await validateWebhookUrl(parsed.data.url);
      if (urlError) {
        return reply.code(400).send({
          error: { code: 'INVALID_URL', message: `Webhook URL rejected: ${urlError}` },
        });
      }
    }

    // Atomic update with ownership check
    const updated = webhookQueries.update(id, parsed.data, session.verusId);
    if (!updated) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Webhook not found' } });
    }

    return { data: { success: true } };
  });

  /**
   * DELETE /v1/me/webhooks/:id — Delete a webhook
   */
  fastify.delete('/v1/me/webhooks/:id', { preHandler: requireAuth }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const { id } = request.params as { id: string };

    const hook = webhookQueries.getById(id);
    if (!hook || hook.agent_verus_id !== session.verusId) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Webhook not found' } });
    }

    webhookQueries.delete(id);
    return { data: { success: true } };
  });

  /**
   * POST /v1/me/webhooks/:id/test — Send a test event
   */
  fastify.post('/v1/me/webhooks/:id/test', {
    preHandler: requireAuth,
    config: { rateLimit: { max: 5, timeWindow: 60_000 } },
  }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const { id } = request.params as { id: string };

    const hook = webhookQueries.getById(id);
    if (!hook || hook.agent_verus_id !== session.verusId) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Webhook not found' } });
    }

    emitWebhookEvent({
      type: 'job.requested',
      agentVerusId: session.verusId,
      data: {
        test: true,
        message: 'This is a test webhook event from Verus Agent Platform',
      },
    });

    return { data: { success: true, message: 'Test event queued for delivery' } };
  });

  /**
   * GET /v1/me/webhooks/:id/deliveries — Delivery history
   */
  fastify.get('/v1/me/webhooks/:id/deliveries', { preHandler: requireAuth }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, string>;
    const limit = Math.min(Math.max(1, parseInt(query.limit || '20', 10) || 20), 100);

    const hook = webhookQueries.getById(id);
    if (!hook || hook.agent_verus_id !== session.verusId) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Webhook not found' } });
    }

    const { getDatabase } = await import('../../db/index.js');
    const db = getDatabase();
    const deliveries = db.prepare(`
      SELECT id, event_type, status, attempts, last_error, created_at, delivered_at
      FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(id, limit) as any[];

    return {
      data: deliveries.map(d => ({
        id: d.id,
        eventType: d.event_type,
        status: d.status,
        attempts: d.attempts,
        lastError: d.last_error,
        createdAt: d.created_at,
        deliveredAt: d.delivered_at,
      })),
    };
  });
}
