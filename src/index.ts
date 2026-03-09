import { initDatabase } from './db/index.js';
import { startServer } from './api/server.js';
import { startIndexer, stopIndexer } from './indexer/indexer.js';
import { startWorker, stopWorker } from './worker/index.js';
import { shutdownNonceStore } from './auth/nonce-store.js';
import { stopAuthCleanup } from './api/routes/auth.js';
import { config } from './config/index.js';
import { startWebhookEngine, stopWebhookEngine } from './notifications/webhook-engine.js';
import { autoReleaseExpired } from './chat/hold-queue.js';
import { logger } from './utils/logger.js';

async function main() {
  logger.info('Starting Verus Agent Platform...');

  // Shield: Refuse to start if SSRF test flags are set in production
  if (process.env.NODE_ENV === 'production') {
    if (process.env.SSRF_ALLOW_LOCALHOST || process.env.SSRF_ALLOW_TEST_PORTS) {
      logger.fatal('SSRF test flags set in production! Remove SSRF_ALLOW_LOCALHOST and SSRF_ALLOW_TEST_PORTS env vars.');
      process.exit(1);
    }
  }

  // P2-VAP-005: Require WEBHOOK_ENCRYPTION_KEY in production
  if (process.env.NODE_ENV === 'production' && !process.env.WEBHOOK_ENCRYPTION_KEY) {
    logger.fatal('WEBHOOK_ENCRYPTION_KEY not set in production. Generate one: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    process.exit(1);
  }

  // Shield: Validate RPC credentials are configured
  if (!config.verus.rpcUser || !config.verus.rpcPass) {
    logger.fatal('Verus RPC credentials not configured. Set VERUS_RPC_USER and VERUS_RPC_PASS in .env');
    process.exit(1);
  }

  // Initialize database
  logger.info('Initializing database...');
  initDatabase();
  logger.info('Database ready');

  // Start API server
  const server = await startServer();

  // Load VDXF schema from chain before indexer starts
  const { loadSchemaFromChain } = await import('./validation/vdxf-keys.js');
  const { getRpcClient } = await import('./indexer/rpc-client.js');
  const rpc = getRpcClient();
  await loadSchemaFromChain((method, params) => rpc.rpcCall(method, params));

  // Start indexer
  logger.info('Starting blockchain indexer...');
  await startIndexer();

  // Start verification worker
  logger.info('Starting verification worker...');
  startWorker();

  // Start webhook delivery engine
  startWebhookEngine();

  // Hold queue: auto-release messages past SLA (every 15 min)
  const holdQueueInterval = setInterval(() => {
    try {
      const released = autoReleaseExpired(24);
      if (released > 0) {
        logger.info({ count: released }, 'Auto-released expired held messages');
      }
    } catch (err) {
      logger.error({ err }, 'Hold queue auto-release error');
    }
  }, 15 * 60 * 1000);
  holdQueueInterval.unref();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down...');

    stopIndexer();
    stopWorker();
    stopWebhookEngine();
    stopAuthCleanup();
    shutdownNonceStore();

    // Close server with 30s timeout to avoid hanging on stuck connections
    await Promise.race([
      server.close(),
      new Promise(resolve => setTimeout(resolve, 30_000)),
    ]);

    // Close database connection (ensures WAL checkpoint completes)
    try {
      const { getDatabase } = await import('./db/index.js');
      getDatabase().close();
      logger.info('Database closed');
    } catch {
      // DB may not be initialized if shutdown during startup
    }

    logger.info('Goodbye!');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled rejection — exiting');
  // Allow time for log flush, then exit
  setTimeout(() => process.exit(1), 1000).unref();
});

main().catch((err) => {
  logger.fatal({ err }, 'Fatal startup error');
  process.exit(1);
});
