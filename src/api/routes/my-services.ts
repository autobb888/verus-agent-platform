/**
 * Protected Service Management Routes
 * 
 * Requires authentication via session cookie.
 * Agents can only manage their own services.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getSessionFromRequest } from './auth.js';
import { serviceQueries, agentQueries } from '../../db/index.js';
import { Service } from '../../db/schema.js';

// Validation schemas
const createServiceSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  price: z.number().min(0),
  currency: z.string().min(1).max(20).default('VRSC'),
  category: z.string().max(100).optional(),
  turnaround: z.string().max(100).optional(),
});

const updateServiceSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional().nullable(),
  price: z.number().min(0).optional(),
  currency: z.string().min(1).max(20).optional(),
  category: z.string().max(100).optional().nullable(),
  turnaround: z.string().max(100).optional().nullable(),
  status: z.enum(['active', 'inactive', 'deprecated']).optional(),
});

// Transform DB service to API response
function transformService(service: Service & { agent_name?: string }) {
  return {
    id: service.id,
    agentId: service.agent_id,
    verusId: service.verus_id,
    agentName: service.agent_name || null,
    name: service.name,
    description: service.description,
    price: service.price,
    currency: service.currency,
    category: service.category,
    turnaround: service.turnaround,
    status: service.status,
    createdAt: service.created_at,
    updatedAt: service.updated_at,
  };
}

// Auth middleware
async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return reply.code(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  }
  // Attach to request for downstream use
  (request as any).session = session;
}

export async function myServiceRoutes(fastify: FastifyInstance): Promise<void> {
  // All routes in this file require authentication
  fastify.addHook('preHandler', requireAuth);

  /**
   * GET /v1/me/services
   * List current user's services
   */
  fastify.get('/v1/me/services', async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    
    // Find the agent by identity address (verus_id in DB is the i-address)
    const agent = agentQueries.getById(session.verusId);
    if (!agent) {
      return {
        data: [],
        meta: { total: 0, message: 'No agent profile found for this identity' },
      };
    }

    const services = serviceQueries.getByAgentId(agent.id);
    
    return {
      data: services.map(s => transformService(s)),
      meta: { total: services.length },
    };
  });

  /**
   * POST /v1/me/services
   * Create a new service
   */
  fastify.post('/v1/me/services', async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    
    // Validate input
    const parsed = createServiceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid service data',
          details: parsed.error.errors,
        },
      });
    }

    // Find the agent
    const agent = agentQueries.getById(session.verusId);
    if (!agent) {
      return reply.code(404).send({
        error: {
          code: 'AGENT_NOT_FOUND',
          message: 'You must register as an agent before listing services',
        },
      });
    }

    const now = new Date().toISOString();
    const serviceData = parsed.data;

    // Create the service
    const serviceId = serviceQueries.insert({
      agent_id: agent.id,
      verus_id: agent.verus_id,
      name: serviceData.name,
      description: serviceData.description || null,
      price: serviceData.price,
      currency: serviceData.currency,
      category: serviceData.category || null,
      turnaround: serviceData.turnaround || null,
      status: 'active',
      session_params: null,
      created_at: now,
      updated_at: now,
      block_height: 0, // Not on-chain yet
    });

    const service = serviceQueries.getById(serviceId);
    
    fastify.log.info({ serviceId, agentId: agent.id }, 'Service created');

    return reply.code(201).send({
      data: transformService(service!),
    });
  });

  /**
   * GET /v1/me/services/:id
   * Get one of your own services
   */
  fastify.get('/v1/me/services/:id', async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const { id } = request.params as { id: string };
    
    const service = serviceQueries.getById(id);
    if (!service) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Service not found' },
      });
    }

    // Verify ownership
    const agent = agentQueries.getById(session.verusId);
    if (!agent || service.agent_id !== agent.id) {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'Not your service' },
      });
    }

    return { data: transformService(service) };
  });

  /**
   * PUT /v1/me/services/:id
   * Update one of your own services
   */
  fastify.put('/v1/me/services/:id', async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const { id } = request.params as { id: string };
    
    // Validate input
    const parsed = updateServiceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid service data',
          details: parsed.error.errors,
        },
      });
    }

    const service = serviceQueries.getById(id);
    if (!service) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Service not found' },
      });
    }

    // Verify ownership
    const agent = agentQueries.getById(session.verusId);
    if (!agent || service.agent_id !== agent.id) {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'Not your service' },
      });
    }

    const updates = {
      ...parsed.data,
      updated_at: new Date().toISOString(),
    };

    serviceQueries.update(id, updates);
    
    const updated = serviceQueries.getById(id);
    fastify.log.info({ serviceId: id }, 'Service updated');

    return { data: transformService(updated!) };
  });

  /**
   * DELETE /v1/me/services/:id
   * Delete one of your own services
   */
  fastify.delete('/v1/me/services/:id', async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const { id } = request.params as { id: string };
    
    const service = serviceQueries.getById(id);
    if (!service) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Service not found' },
      });
    }

    // Verify ownership
    const agent = agentQueries.getById(session.verusId);
    if (!agent || service.agent_id !== agent.id) {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'Not your service' },
      });
    }

    serviceQueries.delete(id);
    fastify.log.info({ serviceId: id }, 'Service deleted');

    return { data: { success: true, id } };
  });
}
