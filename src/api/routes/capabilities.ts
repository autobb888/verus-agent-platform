import { FastifyInstance } from 'fastify';
import { capabilityQueries } from '../../db/index.js';

export async function capabilityRoutes(fastify: FastifyInstance): Promise<void> {
  // List all capability types
  fastify.get('/v1/capabilities', async () => {
    const types = capabilityQueries.getAllTypes();

    return {
      data: types.map((t) => ({
        id: t.capability_id,
        name: t.name,
      })),
    };
  });
}
