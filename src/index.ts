import { initDatabase } from './db/index.js';
import { startServer } from './api/server.js';
import { startIndexer, stopIndexer } from './indexer/indexer.js';
import { startWorker, stopWorker } from './worker/index.js';
import { shutdownNonceStore } from './auth/nonce-store.js';
import { stopAuthCleanup } from './api/routes/auth.js';
import { config } from './config/index.js';
import { startWebhookEngine, stopWebhookEngine } from './notifications/webhook-engine.js';
import { autoReleaseExpired } from './chat/hold-queue.js';

async function main() {
  console.log('[Verus Platform] Starting...');

  // Shield: Refuse to start if SSRF test flags are set in production
  if (process.env.NODE_ENV === 'production') {
    if (process.env.SSRF_ALLOW_LOCALHOST || process.env.SSRF_ALLOW_TEST_PORTS) {
      console.error('❌ FATAL: SSRF test flags set in production! Refusing to start.');
      console.error('   Remove SSRF_ALLOW_LOCALHOST and SSRF_ALLOW_TEST_PORTS env vars.');
      process.exit(1);
    }
  }

  // P2-VAP-005: Require WEBHOOK_ENCRYPTION_KEY in production
  if (process.env.NODE_ENV === 'production' && !process.env.WEBHOOK_ENCRYPTION_KEY) {
    console.error('❌ FATAL: WEBHOOK_ENCRYPTION_KEY not set in production.');
    console.error('   Generate one: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    process.exit(1);
  }

  // Shield: Validate RPC credentials are configured
  if (!config.verus.rpcUser || !config.verus.rpcPass) {
    console.error('❌ FATAL: Verus RPC credentials not configured.');
    console.error('   Set VERUS_RPC_USER and VERUS_RPC_PASS in .env');
    process.exit(1);
  }

  // Initialize database
  console.log('[DB] Initializing database...');
  initDatabase();
  console.log('[DB] Database ready');

  // Start API server
  const server = await startServer();

  // Start indexer
  console.log('[Indexer] Starting blockchain indexer...');
  await startIndexer();

  // Start verification worker
  console.log('[Worker] Starting verification worker...');
  startWorker();

  // Start webhook delivery engine
  startWebhookEngine();

  // Hold queue: auto-release messages past SLA (every 15 min)
  const holdQueueInterval = setInterval(() => {
    try {
      const released = autoReleaseExpired(24);
      if (released > 0) {
        console.log(`[HoldQueue] Auto-released ${released} expired messages`);
      }
    } catch (err) {
      console.error('[HoldQueue] Auto-release error:', err);
    }
  }, 15 * 60 * 1000);
  holdQueueInterval.unref();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[Verus Platform] Received ${signal}, shutting down...`);
    
    stopIndexer();
    stopWorker();
    stopWebhookEngine();
    stopAuthCleanup();
    shutdownNonceStore();
    await server.close();
    
    console.log('[Verus Platform] Goodbye!');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection:', reason);
});

main().catch((err) => {
  console.error('[Verus Platform] Fatal error:', err);
  process.exit(1);
});
