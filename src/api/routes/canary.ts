import { safeJsonParse } from '../../utils/safe-json.js';
/**
 * Canary Token Routes
 * 
 * POST /v1/me/canary    — Register a canary token for the authenticated agent
 * GET  /v1/me/canary     — Get your registered canary tokens
 * DELETE /v1/me/canary/:id — Remove a canary token
 * 
 * Canary tokens are registered by agents via the SDK. When SafeChat's
 * outbound scanner sees a registered canary in an agent's response,
 * it holds the message — preventing system prompt leaks.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/index.js';
import { getSessionFromRequest } from './auth.js';

async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return reply.code(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  }
  (request as any).session = session;
}

export async function canaryRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDatabase();

  // Ensure table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_canaries (
      id TEXT PRIMARY KEY,
      verus_id TEXT NOT NULL,
      token TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT 'safechat-canary-v1',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_canaries_verus_id ON agent_canaries(verus_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_canaries_token ON agent_canaries(token)`);

  const insertCanary = db.prepare(`INSERT INTO agent_canaries (id, verus_id, token, format) VALUES (?, ?, ?, ?)`);
  const getCanaries = db.prepare(`SELECT id, token, format, created_at FROM agent_canaries WHERE verus_id = ?`);
  const deleteCanary = db.prepare(`DELETE FROM agent_canaries WHERE id = ? AND verus_id = ?`);
  const findByToken = db.prepare(`SELECT verus_id FROM agent_canaries WHERE token = ?`);

  // POST /v1/me/canary — Register a canary token
  fastify.post('/v1/me/canary', {
    preHandler: requireAuth,
    config: { rateLimit: { max: 10, timeWindow: 60_000 } },
  }, async (request, reply) => {
    const session = (request as any).session;
    const body = request.body as Record<string, unknown>;
    const token = typeof body?.token === 'string' ? body.token : '';
    const format = typeof body?.format === 'string' ? body.format.slice(0, 50) : undefined;

    if (!token || token.length < 4 || token.length > 200) {
      return reply.code(400).send({
        error: { code: 'INVALID_TOKEN', message: 'Token must be 4-200 characters' },
      });
    }

    // Check limit (max 5 canaries per agent)
    const existing = getCanaries.all(session.verusId) as any[];
    if (existing.length >= 5) {
      return reply.code(400).send({
        error: { code: 'LIMIT_REACHED', message: 'Maximum 5 canary tokens per agent' },
      });
    }

    const id = uuidv4();
    insertCanary.run(id, session.verusId, token, format || 'safechat-canary-v1');

    console.log(`[Canary] Registered for ${session.verusId}: ${token.substring(0, 10)}...`);

    return reply.code(201).send({ id, status: 'registered' });
  });

  // GET /v1/me/canary — List your canary tokens
  fastify.get('/v1/me/canary', { preHandler: requireAuth }, async (request, reply) => {
    const session = (request as any).session;
    const canaries = getCanaries.all(session.verusId);
    return reply.send({ canaries });
  });

  // DELETE /v1/me/canary/:id — Remove a canary token
  fastify.delete('/v1/me/canary/:id', { preHandler: requireAuth }, async (request, reply) => {
    const session = (request as any).session;
    const { id } = request.params as { id: string };

    const result = deleteCanary.run(id, session.verusId);
    if (result.changes === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Canary not found' } });
    }

    return reply.send({ status: 'deleted' });
  });

  // Exported for SafeChat integration — check if a token is a registered canary
  (fastify as any).canaryLookup = (token: string): string | null => {
    const row = findByToken.get(token) as any;
    return row?.verus_id || null;
  };

  // ------------------------------------------
  // Communication Policy
  // ------------------------------------------

  // Ensure column exists (migration-safe)
  try {
    db.exec(`ALTER TABLE agents ADD COLUMN communication_policy TEXT DEFAULT 'safechat_only'`);
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE agents ADD COLUMN external_channels TEXT DEFAULT NULL`);
  } catch { /* column already exists */ }

  const VALID_POLICIES = ['safechat_only', 'safechat_preferred', 'external'];

  const updatePolicy = db.prepare(`
    UPDATE agents SET communication_policy = ?, external_channels = ?, updated_at = datetime('now')
    WHERE verus_id = ?
  `);

  // POST /v1/me/communication-policy
  fastify.post('/v1/me/communication-policy', {
    preHandler: requireAuth,
    config: { rateLimit: { max: 10, timeWindow: 60_000 } },
  }, async (request, reply) => {
    const session = (request as any).session;
    const { policy, externalChannels } = request.body as {
      policy?: string;
      externalChannels?: { type: string; handle?: string }[];
    };

    if (!policy || !VALID_POLICIES.includes(policy)) {
      return reply.code(400).send({
        error: { code: 'INVALID_POLICY', message: `Policy must be one of: ${VALID_POLICIES.join(', ')}` },
      });
    }

    // Validate external channels if not safechat_only
    if (policy !== 'safechat_only' && (!externalChannels || externalChannels.length === 0)) {
      return reply.code(400).send({
        error: { code: 'CHANNELS_REQUIRED', message: 'External channels must be specified when policy is not safechat_only' },
      });
    }

    const channelsJson = externalChannels ? JSON.stringify(externalChannels) : null;
    const result = updatePolicy.run(policy, channelsJson, session.verusId);

    if (result.changes === 0) {
      return reply.code(404).send({
        error: { code: 'AGENT_NOT_FOUND', message: 'No agent found for your identity' },
      });
    }

    console.log(`[Policy] ${session.verusId} set communication policy to: ${policy}`);

    return reply.send({
      status: 'updated',
      policy,
      externalChannels: externalChannels || null,
    });
  });

  // GET /v1/me/communication-policy
  fastify.get('/v1/me/communication-policy', { preHandler: requireAuth }, async (request, reply) => {
    const session = (request as any).session;

    const agent = db.prepare(
      `SELECT communication_policy, external_channels FROM agents WHERE verus_id = ?`
    ).get(session.verusId) as any;

    if (!agent) {
      return reply.code(404).send({
        error: { code: 'AGENT_NOT_FOUND', message: 'No agent found for your identity' },
      });
    }

    return reply.send({
      policy: agent.communication_policy || 'safechat_only',
      externalChannels: safeJsonParse(agent.external_channels),
    });
  });
}
