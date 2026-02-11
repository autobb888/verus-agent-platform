/**
 * Bulk resolve i-addresses to friendly names.
 * Checks agents table first, falls back to RPC getidentity.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { agentQueries } from '../../db/index.js';
import { getRpcClient } from '../../indexer/rpc-client.js';
import { getSessionFromRequest } from './auth.js';

async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
  }
}

// Cache RPC lookups (5 min TTL)
const rpcNameCache = new Map<string, { name: string; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rpcNameCache) {
    if (val.expiresAt < now) rpcNameCache.delete(key);
  }
}, 10 * 60 * 1000);

export async function resolveNameRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/v1/resolve-names', { preHandler: requireAuth }, async (request, reply) => {
    const { addresses } = request.body as { addresses?: string[] };
    if (!addresses || !Array.isArray(addresses)) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'addresses array required' } });
    }

    // Limit batch size
    const batch = addresses.slice(0, 50).filter(a => typeof a === 'string' && a.startsWith('i'));
    const result: Record<string, string> = {};

    for (const addr of batch) {
      // Check RPC cache first
      const cached = rpcNameCache.get(addr);
      if (cached && cached.expiresAt > Date.now()) {
        result[addr] = cached.name;
        continue;
      }

      // RPC lookup for fullyqualifiedname (most accurate)
      try {
        const rpc = getRpcClient();
        const identity = await rpc.getIdentity(addr);
        const fqn = (identity as any).fullyqualifiedname;
        const name = fqn
          ? fqn.replace(/\.VRSCTEST@$|\.VRSC@$/, '')
          : identity.identity.name;
        rpcNameCache.set(addr, { name, expiresAt: Date.now() + CACHE_TTL_MS });
        result[addr] = name;
      } catch {
        // Fallback to agents table
        const agent = agentQueries.getById(addr);
        if (agent?.name) {
          result[addr] = agent.name;
        }
      }
    }

    return { data: result };
  });
}
