import { safeJsonParse } from '../../utils/safe-json.js';
/**
 * Unified Notifications API (Phase 6d)
 * 
 * Single polling endpoint for agents that don't use webhooks.
 * Returns all unread events: new messages, job status changes, file uploads, alerts.
 * 
 * Endpoints:
 * - GET  /v1/me/notifications       — Get all pending notifications
 * - POST /v1/me/notifications/ack    — Acknowledge (dismiss) notifications
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getSessionFromRequest } from './auth.js';
import { getDatabase } from '../../db/index.js';
import { z } from 'zod';
import { randomUUID } from 'crypto';

async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
  }
  (request as any).session = session;
}

const ackSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
});

export async function notificationRoutes(fastify: FastifyInstance): Promise<void> {

  // Periodic cleanup of old notifications (every 6 hours)
  const notifCleanupInterval = setInterval(() => {
    try {
      const deleted = cleanupOldNotifications();
      if (deleted > 0) console.log(`[Notifications] Cleaned up ${deleted} old notifications`);
    } catch {}
  }, 6 * 60 * 60 * 1000);
  notifCleanupInterval.unref();

  /**
   * GET /v1/me/notifications — All pending notifications
   */
  fastify.get('/v1/me/notifications', { preHandler: requireAuth }, async (request) => {
    const session = (request as any).session as { verusId: string };
    const query = request.query as Record<string, string>;
    const includeRead = query.includeRead === 'true';
    const limit = Math.min(Math.max(1, parseInt(query.limit || '50', 10) || 50), 100);
    const since = query.since && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(query.since) ? query.since : undefined;

    const db = getDatabase();

    let sql = `SELECT * FROM notifications WHERE recipient_verus_id = ?`;
    const params: any[] = [session.verusId];

    if (!includeRead) {
      sql += ` AND read = 0`;
    }
    if (since) {
      sql += ` AND created_at > ?`;
      params.push(since);
    }

    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);

    const rows = db.prepare(sql).all(...params) as any[];

    return {
      data: rows.map(r => ({
        id: r.id,
        type: r.type,
        title: r.title,
        body: r.body,
        jobId: r.job_id,
        data: safeJsonParse(r.data, {}),
        read: r.read === 1,
        createdAt: r.created_at,
      })),
      meta: { unreadCount: (db.prepare(`SELECT COUNT(*) as c FROM notifications WHERE recipient_verus_id = ? AND read = 0`).get(session.verusId) as { c: number }).c },
    };
  });

  /**
   * POST /v1/me/notifications/ack — Mark notifications as read
   */
  fastify.post('/v1/me/notifications/ack', {
    preHandler: requireAuth,
    config: { rateLimit: { max: 30, timeWindow: 60_000 } },
  }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };

    const parsed = ackSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid data', details: parsed.error.errors },
      });
    }

    const db = getDatabase();
    const stmt = db.prepare(`UPDATE notifications SET read = 1 WHERE id = ? AND recipient_verus_id = ?`);
    let acked = 0;
    for (const id of parsed.data.ids) {
      acked += stmt.run(id, session.verusId).changes;
    }

    return { data: { acknowledged: acked } };
  });
}

/**
 * Create a notification for a user (called from other modules)
 */
export function createNotification(data: {
  recipientVerusId: string;
  type: string;
  title: string;
  body?: string;
  jobId?: string;
  extra?: Record<string, any>;
}): string {
  const db = getDatabase();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO notifications (id, recipient_verus_id, type, title, body, job_id, data) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, data.recipientVerusId, data.type, data.title, data.body || null, data.jobId || null, JSON.stringify(data.extra || {}));
  return id;
}

/**
 * Clean up old notifications to prevent unbounded table growth.
 * Deletes read notifications older than 7 days and all notifications older than 90 days.
 */
export function cleanupOldNotifications(): number {
  const db = getDatabase();
  return db.prepare(`
    DELETE FROM notifications
    WHERE (read = 1 AND created_at < datetime('now', '-7 days'))
       OR created_at < datetime('now', '-90 days')
  `).run().changes;
}
