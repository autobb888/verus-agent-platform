// Phase 3: Services API routes
// P2P commerce - agents list services, platform indexes them

import { FastifyInstance } from 'fastify';
import { serviceQueries, agentQueries } from '../../db/index.js';
import { Service } from '../../db/schema.js';

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
    indexedAt: service.indexed_at,
    blockHeight: service.block_height,
    sessionParams: service.session_params ? JSON.parse(service.session_params) : null,
  };
}

export async function serviceRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /v1/services
   * List all services with filtering
   */
  fastify.get('/v1/services', async (request, reply) => {
    const query = request.query as Record<string, string>;
    
    const filters = {
      agentId: query.agentId,
      verusId: query.verusId,
      category: query.category,
      status: query.status || 'active',
      minPrice: query.minPrice ? parseFloat(query.minPrice) : undefined,
      maxPrice: query.maxPrice ? parseFloat(query.maxPrice) : undefined,
      q: query.q || undefined,
      limit: parseInt(query.limit || '20', 10),
      offset: parseInt(query.offset || '0', 10),
      sort: query.sort || 'created_at',
      order: (query.order as 'asc' | 'desc') || 'desc',
    };

    const services = serviceQueries.getAll(filters);
    const total = serviceQueries.count({ 
      status: filters.status,
      category: filters.category,
    });

    return {
      data: services.map(transformService),
      meta: {
        total,
        limit: filters.limit,
        offset: filters.offset,
        hasMore: filters.offset + services.length < total,
      },
    };
  });

  /**
   * GET /v1/services/categories
   * List all unique service categories
   */
  fastify.get('/v1/services/categories', async () => {
    const categories = serviceQueries.getCategories();
    return {
      data: categories.map((c) => c.category),
    };
  });

  /**
   * GET /v1/services/:id
   * Get a specific service by ID
   */
  fastify.get('/v1/services/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const service = serviceQueries.getById(id);

    if (!service) {
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: 'Service not found',
        },
      });
    }

    return { data: transformService(service) };
  });

  /**
   * GET /v1/services/agent/:verusId
   * Get all services for a specific agent
   */
  fastify.get('/v1/services/agent/:verusId', async (request, reply) => {
    const { verusId } = request.params as { verusId: string };
    
    const agent = agentQueries.getById(verusId);
    if (!agent) {
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: 'Agent not found',
        },
      });
    }

    const services = serviceQueries.getByAgentId(agent.id);

    return {
      data: services.map(transformService),
      agent: {
        verusId: agent.verus_id,
        name: agent.name,
      },
    };
  });
}
