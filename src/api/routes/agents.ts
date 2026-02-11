import { FastifyInstance } from 'fastify';
import { agentQueries, capabilityQueries, endpointQueries } from '../../db/index.js';
import { ListAgentsQuery, AgentIdParam, validateQueryParams, ApiResponse, PaginationMeta } from '../../validation/api-schema.js';
import { Agent, AgentCapability, AgentEndpoint } from '../../db/schema.js';
import { getNameFlagInfo } from '../../utils/name-flags.js';

// Transform DB agent to API response
function transformAgent(agent: Agent) {
  return {
    id: agent.verus_id,
    internalId: agent.id,
    name: agent.name,
    type: agent.type,
    description: agent.description,
    owner: agent.owner,
    status: agent.status,
    revoked: Boolean(agent.revoked),
    createdAt: agent.created_at,
    updatedAt: agent.updated_at,
    indexedAt: agent.indexed_at,
    blockHeight: agent.block_height,
    // Name flagging for impersonation warnings (does not block, just warns)
    trustInfo: getNameFlagInfo(agent.name),
  };
}

// Transform capability to API response
function transformCapability(cap: AgentCapability) {
  return {
    id: cap.capability_id,
    name: cap.name,
    description: cap.description,
    protocol: cap.protocol,
    endpoint: cap.endpoint,
    public: Boolean(cap.public),
    pricing: cap.pricing_model
      ? {
          model: cap.pricing_model,
          amount: cap.pricing_amount?.toString(),
          currency: cap.pricing_currency,
        }
      : null,
  };
}

export async function agentRoutes(fastify: FastifyInstance): Promise<void> {
  // List agents
  fastify.get('/v1/agents', async (request, reply) => {
    const validation = validateQueryParams(ListAgentsQuery, request.query);
    
    if (!validation.success) {
      return reply.code(400).send({
        error: {
          code: 'INVALID_QUERY',
          message: validation.error,
        },
      });
    }

    const params = validation.data;
    const agents = agentQueries.getAll(params);
    const total = agentQueries.count({ status: params.status, type: params.type, owner: params.owner });

    const limit = params.limit ?? 20;
    const offset = params.offset ?? 0;
    
    const meta: PaginationMeta = {
      total,
      limit,
      offset,
      hasMore: offset + agents.length < total,
    };

    const response: ApiResponse<ReturnType<typeof transformAgent>[]> = {
      data: agents.map(transformAgent),
      meta,
    };

    return response;
  });

  // Get agent by ID (VerusID)
  fastify.get('/v1/agents/:id', async (request, reply) => {
    const validation = validateQueryParams(AgentIdParam, request.params);
    
    if (!validation.success) {
      return reply.code(400).send({
        error: {
          code: 'INVALID_PARAMS',
          message: validation.error,
        },
      });
    }

    const agent = agentQueries.getById(validation.data.id);
    
    if (!agent) {
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: 'Agent not found',
        },
      });
    }

    // Get related data
    const capabilities = capabilityQueries.getByAgentId(agent.id);
    const endpoints = endpointQueries.getByAgentId(agent.id);

    return {
      data: {
        ...transformAgent(agent),
        capabilities: capabilities.map(transformCapability),
        endpoints: endpoints.map((ep) => ({
          url: ep.url,
          protocol: ep.protocol,
          public: Boolean(ep.public),
        })),
      },
    };
  });

  // Get agent capabilities
  fastify.get('/v1/agents/:id/capabilities', async (request, reply) => {
    const validation = validateQueryParams(AgentIdParam, request.params);
    
    if (!validation.success) {
      return reply.code(400).send({
        error: {
          code: 'INVALID_PARAMS',
          message: validation.error,
        },
      });
    }

    const agent = agentQueries.getById(validation.data.id);
    
    if (!agent) {
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: 'Agent not found',
        },
      });
    }

    const capabilities = capabilityQueries.getByAgentId(agent.id);

    return {
      data: capabilities.map(transformCapability),
    };
  });
}
