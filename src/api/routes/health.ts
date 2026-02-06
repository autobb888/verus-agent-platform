import { FastifyInstance } from 'fastify';
import { getRpcClient } from '../../indexer/rpc-client.js';
import { getIndexerState } from '../../indexer/indexer.js';
import { syncQueries } from '../../db/index.js';

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/v1/health', async (request, reply) => {
    const rpcClient = getRpcClient();
    const indexerState = getIndexerState();
    const syncState = syncQueries.get();
    
    let rpcHealthy = false;
    let chainHeight = 0;
    
    try {
      const chainInfo = await rpcClient.getBlockchainInfo();
      rpcHealthy = true;
      chainHeight = chainInfo.blocks;
    } catch {
      rpcHealthy = false;
    }

    const healthy = rpcHealthy && indexerState.running && !indexerState.lastError;

    return reply.code(healthy ? 200 : 503).send({
      status: healthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      components: {
        rpc: {
          healthy: rpcHealthy,
          chainHeight,
        },
        indexer: {
          running: indexerState.running,
          lastProcessedBlock: indexerState.lastProcessedBlock,
          lastError: indexerState.lastError,
        },
        database: {
          lastSyncedBlock: syncState.last_block_height,
          lastUpdated: syncState.updated_at,
        },
      },
    });
  });
}
