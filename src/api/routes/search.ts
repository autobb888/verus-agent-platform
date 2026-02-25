/**
 * Search Routes
 * 
 * GET /v1/search - Full-text search over agents
 * 
 * Uses PostgreSQL FTS (pg_trgm) for fuzzy matching.
 * For SQLite, falls back to LIKE queries.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDatabase } from '../../db/index.js';

// Search query schema
const searchSchema = z.object({
  q: z.string().min(1).max(100),
  type: z.enum(['autonomous', 'assisted', 'hybrid', 'tool']).optional(),
  status: z.enum(['active', 'inactive', 'deprecated']).optional(),
  verified: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

export async function searchRoutes(fastify: FastifyInstance): Promise<void> {
  
  /**
   * GET /v1/search
   * 
   * Full-text search over agents.
   */
  fastify.get('/v1/search', {
    config: {
      rateLimit: { max: 30, timeWindow: 60_000 },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // Parse query params
    const parsed = searchSchema.safeParse(request.query);
    
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid search parameters',
          details: parsed.error.errors.map(e => e.message),
        },
      });
    }
    
    const { q, type, status, verified, limit, offset } = parsed.data;
    
    try {
      const db = getDatabase();
      
      // Build search query (SQLite version - uses LIKE)
      // TODO: Upgrade to PostgreSQL FTS with pg_trgm for production
      let query = `
        SELECT 
          a.id,
          a.verus_id,
          a.name,
          a.type,
          a.description,
          a.status,
          a.created_at,
          a.updated_at
        FROM agents a
        WHERE 1=1
      `;
      const params: any[] = [];
      
      // Full-text search on name and description
      // P2-SEARCH-1: Escape LIKE metacharacters to prevent pattern injection
      const escapedQ = q.replace(/[%_\\]/g, '\\$&');
      query += ` AND (a.name LIKE ? ESCAPE '\\' OR a.description LIKE ? ESCAPE '\\')`;
      params.push(`%${escapedQ}%`, `%${escapedQ}%`);
      
      // Type filter
      if (type) {
        query += ` AND a.type = ?`;
        params.push(type);
      }
      
      // Status filter
      if (status) {
        query += ` AND a.status = ?`;
        params.push(status);
      }
      
      // Verified filter (has any verified endpoint)
      if (verified === 'true') {
        query += ` AND EXISTS (
          SELECT 1 FROM agent_endpoints e 
          WHERE e.agent_id = a.id AND e.verified = 1
        )`;
      } else if (verified === 'false') {
        query += ` AND NOT EXISTS (
          SELECT 1 FROM agent_endpoints e 
          WHERE e.agent_id = a.id AND e.verified = 1
        )`;
      }
      
      // Ordering and pagination
      query += ` ORDER BY a.name ASC LIMIT ? OFFSET ?`;
      params.push(limit, offset);
      
      const agents = db.prepare(query).all(...params) as any[];
      
      // Get total count (for pagination)
      let countQuery = `
        SELECT COUNT(*) as total
        FROM agents a
        WHERE 1=1
      `;
      const countParams: any[] = [];
      
      countQuery += ` AND (a.name LIKE ? ESCAPE '\\' OR a.description LIKE ? ESCAPE '\\')`;
      countParams.push(`%${escapedQ}%`, `%${escapedQ}%`);
      
      if (type) {
        countQuery += ` AND a.type = ?`;
        countParams.push(type);
      }
      
      if (status) {
        countQuery += ` AND a.status = ?`;
        countParams.push(status);
      }
      
      if (verified === 'true') {
        countQuery += ` AND EXISTS (
          SELECT 1 FROM agent_endpoints e 
          WHERE e.agent_id = a.id AND e.verified = 1
        )`;
      } else if (verified === 'false') {
        countQuery += ` AND NOT EXISTS (
          SELECT 1 FROM agent_endpoints e 
          WHERE e.agent_id = a.id AND e.verified = 1
        )`;
      }
      
      const { total } = db.prepare(countQuery).get(...countParams) as { total: number };
      
      return {
        data: agents.map(a => ({
          id: a.id,
          verusId: a.verus_id,
          name: a.name,
          type: a.type,
          description: a.description,
          status: a.status,
          createdAt: a.created_at,
          updatedAt: a.updated_at,
        })),
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + agents.length < total,
        },
      };
      
    } catch (error) {
      fastify.log.error({ error }, 'Search failed');
      return reply.code(500).send({
        error: { code: 'INTERNAL_ERROR', message: 'Search failed' }
      });
    }
  });
}
