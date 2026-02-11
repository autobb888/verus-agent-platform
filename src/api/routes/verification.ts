/**
 * Verification Routes
 * 
 * GET /v1/agents/:id/verification - Get verification status
 * POST /v1/agents/:id/verify - Trigger manual verification (signed)
 */

import { FastifyInstance } from 'fastify';
import { getDatabase } from '../../db/index.js';
import { createVerification } from '../../worker/verification.js';
import { getWorkerStatus } from '../../worker/index.js';

export async function verificationRoutes(fastify: FastifyInstance): Promise<void> {
  
  // GET /v1/agents/:id/verification - Get verification status for all endpoints
  fastify.get('/v1/agents/:id/verification', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    const db = getDatabase();
    
    // Find agent
    const agent = db.prepare('SELECT id, verus_id FROM agents WHERE verus_id = ?').get(id) as any;
    
    if (!agent) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Agent not found' },
      });
    }
    
    // Get verification status for all endpoints
    const verifications = db.prepare(`
      SELECT 
        e.id as endpoint_id,
        e.url,
        e.protocol,
        e.verified,
        e.verified_at as endpoint_verified_at,
        v.id as verification_id,
        v.status,
        v.retry_count,
        v.last_attempt_at,
        v.verified_at,
        v.next_verification_at,
        v.error_message
      FROM agent_endpoints e
      LEFT JOIN endpoint_verifications v ON e.id = v.endpoint_id
      WHERE e.agent_id = ?
      ORDER BY e.url
    `).all(agent.id) as any[];
    
    return {
      data: {
        agentId: id,
        endpoints: verifications.map(v => ({
          endpointId: v.endpoint_id,
          url: v.url,
          protocol: v.protocol,
          verified: Boolean(v.verified),
          status: v.status || 'no_verification',
          retryCount: v.retry_count || 0,
          lastAttempt: v.last_attempt_at,
          verifiedAt: v.verified_at,
          nextVerification: v.next_verification_at,
          error: v.error_message,
        })),
        summary: {
          total: verifications.length,
          verified: verifications.filter(v => v.status === 'verified').length,
          pending: verifications.filter(v => v.status === 'pending').length,
          failed: verifications.filter(v => v.status === 'failed').length,
        },
      },
    };
  });

  // GET /v1/verification/status - Get worker status
  fastify.get('/v1/verification/status', async (request, reply) => {
    const db = getDatabase();
    
    const stats = db.prepare(`
      SELECT 
        status,
        COUNT(*) as count
      FROM endpoint_verifications
      GROUP BY status
    `).all() as { status: string; count: number }[];
    
    const workerStatus = getWorkerStatus();
    
    return {
      data: {
        worker: workerStatus,
        verifications: Object.fromEntries(stats.map(s => [s.status, s.count])),
        total: stats.reduce((sum, s) => sum + s.count, 0),
      },
    };
  });
}
