import { FastifyInstance } from 'fastify';
import { statsQueries } from '../../db/index.js';

export async function statsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/v1/stats', async () => {
    const stats = statsQueries.getStats();

    return {
      data: {
        agents: {
          total: stats.totalAgents,
          active: stats.activeAgents,
          byType: stats.byType,
        },
        capabilities: {
          totalTypes: stats.totalCapabilityTypes,
        },
        indexer: {
          lastBlock: stats.lastIndexedBlock,
          lastUpdated: stats.lastUpdated,
        },
      },
    };
  });
}
