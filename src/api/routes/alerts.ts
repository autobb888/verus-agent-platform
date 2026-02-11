/**
 * Anomaly Alerts API (Phase 6c)
 * 
 * Proactive buyer safety alerts when agent behavior is suspicious.
 * Shield: Max 3 alerts per job per hour. Start conservative. Track dismiss rate.
 * 
 * Endpoints:
 * - GET  /v1/me/alerts          — Get my pending alerts
 * - POST /v1/alerts/:id/dismiss — Dismiss an alert
 * - POST /v1/alerts/:id/report  — Report based on alert
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDatabase } from '../../db/index.js';
import { jobQueries } from '../../db/index.js';
import { getSessionFromRequest } from './auth.js';
import { randomUUID } from 'crypto';

// Shield: Max 3 alerts per job per hour
const MAX_ALERTS_PER_JOB_PER_HOUR = 3;
// Shield: Rate-limit reports: 3/job, 10/buyer/week
const MAX_REPORTS_PER_JOB = 3;
const MAX_REPORTS_PER_BUYER_PER_WEEK = 10;

export type AlertType = 
  | 'unusual_data_request'
  | 'external_link'
  | 'behavioral_shift'
  | 'excessive_data_collection'
  | 'scope_violation'
  | 'financial_anomaly'
  | 'pii_detected'
  | 'malicious_code';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface AlertRecord {
  id: string;
  job_id: string;
  buyer_verus_id: string;
  agent_verus_id: string;
  message_id: string | null;
  type: string;
  severity: string;
  title: string;
  detail: string;
  suggested_action: string;
  status: string;            // pending | dismissed | reported | expired
  created_at: string;
  resolved_at: string | null;
}

// ---- Alert creation (called from output scanner integration) ----

/**
 * Create an alert for a buyer. Respects rate limits.
 * Returns the alert ID if created, null if rate-limited.
 */
export function createAlert(params: {
  jobId: string;
  buyerVerusId: string;
  agentVerusId: string;
  messageId?: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  detail: string;
  suggestedAction: 'dismiss' | 'caution' | 'block' | 'report';
}): string | null {
  const db = getDatabase();

  // Shield: Max 3 alerts per job per hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recentCount = db.prepare(`
    SELECT COUNT(*) as count FROM alerts 
    WHERE job_id = ? AND created_at > ?
  `).get(params.jobId, oneHourAgo) as { count: number };

  if (recentCount.count >= MAX_ALERTS_PER_JOB_PER_HOUR) {
    return null; // Rate limited
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO alerts (id, job_id, buyer_verus_id, agent_verus_id, message_id,
      type, severity, title, detail, suggested_action, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(
    id,
    params.jobId,
    params.buyerVerusId,
    params.agentVerusId,
    params.messageId || null,
    params.type,
    params.severity,
    params.title,
    // Shield: Don't include scanner-specific evidence in detail shown to agents
    params.detail,
    params.suggestedAction
  );

  return id;
}

// ---- Auth middleware ----

async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return reply.code(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  }
  (request as any).session = session;
}

// ---- Routes ----

export async function alertRoutes(fastify: FastifyInstance): Promise<void> {

  /**
   * GET /v1/me/alerts
   * Get my pending alerts
   */
  fastify.get('/v1/me/alerts', { preHandler: requireAuth }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const query = request.query as Record<string, string>;
    const status = query.status || 'pending';
    const limit = Math.min(parseInt(query.limit || '20', 10), 100);

    const db = getDatabase();
    const alerts = db.prepare(`
      SELECT * FROM alerts 
      WHERE buyer_verus_id = ? AND status = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(session.verusId, status, limit) as AlertRecord[];

    const pendingCount = db.prepare(`
      SELECT COUNT(*) as count FROM alerts
      WHERE buyer_verus_id = ? AND status = 'pending'
    `).get(session.verusId) as { count: number };

    return {
      data: alerts.map(a => ({
        id: a.id,
        jobId: a.job_id,
        agentVerusId: a.agent_verus_id,
        messageId: a.message_id,
        type: a.type,
        severity: a.severity,
        title: a.title,
        detail: a.detail,
        suggestedAction: a.suggested_action,
        status: a.status,
        createdAt: a.created_at,
      })),
      meta: { pendingCount: pendingCount.count },
    };
  });

  /**
   * POST /v1/alerts/:id/dismiss
   * Dismiss an alert
   */
  fastify.post('/v1/alerts/:id/dismiss', { preHandler: requireAuth }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const { id } = request.params as { id: string };

    const db = getDatabase();
    const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(id) as AlertRecord | undefined;

    if (!alert || alert.buyer_verus_id !== session.verusId) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Alert not found' },
      });
    }

    db.prepare(`
      UPDATE alerts SET status = 'dismissed', resolved_at = datetime('now') WHERE id = ?
    `).run(id);

    return { data: { dismissed: true } };
  });

  /**
   * POST /v1/alerts/:id/report
   * Report an agent based on an alert
   */
  fastify.post('/v1/alerts/:id/report', { preHandler: requireAuth }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const { id } = request.params as { id: string };

    const schema = z.object({
      reason: z.string().min(1).max(2000),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Reason required' },
      });
    }

    const db = getDatabase();
    const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(id) as AlertRecord | undefined;

    if (!alert || alert.buyer_verus_id !== session.verusId) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Alert not found' },
      });
    }

    // Shield: Rate-limit reports — 3/job
    const jobReportCount = db.prepare(`
      SELECT COUNT(*) as count FROM alerts 
      WHERE job_id = ? AND buyer_verus_id = ? AND status = 'reported'
    `).get(alert.job_id, session.verusId) as { count: number };

    if (jobReportCount.count >= MAX_REPORTS_PER_JOB) {
      return reply.code(429).send({
        error: { code: 'REPORT_LIMIT', message: 'Maximum reports per job reached' },
      });
    }

    // Shield: Rate-limit reports — 10/buyer/week
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const weeklyReportCount = db.prepare(`
      SELECT COUNT(*) as count FROM alerts 
      WHERE buyer_verus_id = ? AND status = 'reported' AND resolved_at > ?
    `).get(session.verusId, oneWeekAgo) as { count: number };

    if (weeklyReportCount.count >= MAX_REPORTS_PER_BUYER_PER_WEEK) {
      return reply.code(429).send({
        error: { code: 'REPORT_LIMIT', message: 'Weekly report limit reached' },
      });
    }

    db.prepare(`
      UPDATE alerts SET status = 'reported', resolved_at = datetime('now') WHERE id = ?
    `).run(id);

    // Log the report for platform review
    db.prepare(`
      INSERT INTO alert_reports (id, alert_id, reporter_verus_id, agent_verus_id, job_id, reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), id, session.verusId, alert.agent_verus_id, alert.job_id, parsed.data.reason);

    fastify.log.warn({ alertId: id, reporter: session.verusId, agent: alert.agent_verus_id }, 'Agent reported via alert');

    return { data: { reported: true } };
  });
}
