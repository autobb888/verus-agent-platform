/**
 * Bulk resolve i-addresses to friendly names.
 * Checks agents table first, falls back to RPC getidentity.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { agentQueries } from '../../db/index.js';
import { getRpcClient } from '../../indexer/rpc-client.js';
import { getSessionFromRequest } from './auth.js';

async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
  }
}

// Cache RPC lookups (5 min TTL, max 10K entries)
const rpcNameCache = new Map<string, { name: string; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_NAME_CACHE_SIZE = 10_000;

const resolveNamesCacheCleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rpcNameCache) {
    if (val.expiresAt < now) rpcNameCache.delete(key);
  }
}, 10 * 60 * 1000);
resolveNamesCacheCleanup.unref();

export async function resolveNameRoutes(fastify: FastifyInstance): Promise<void> {
  const resolveSchema = z.object({
    addresses: z.array(z.string().max(100)).min(1).max(50),
  });

  fastify.post('/v1/resolve-names', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = resolveSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'addresses array required (max 50)' } });
    }

    // Filter to valid i-addresses only
    const batch = parsed.data.addresses.filter(a => a.startsWith('i'));
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
        rpcNameCache.delete(addr);
        rpcNameCache.set(addr, { name, expiresAt: Date.now() + CACHE_TTL_MS });
        while (rpcNameCache.size > MAX_NAME_CACHE_SIZE) {
          const oldest = rpcNameCache.keys().next().value;
          if (oldest !== undefined) rpcNameCache.delete(oldest); else break;
        }
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
