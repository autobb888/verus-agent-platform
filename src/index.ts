import { initDatabase } from './db/index.js';
import { startServer } from './api/server.js';
import { startIndexer, stopIndexer } from './indexer/indexer.js';

async function main() {
  console.log('[Verus Platform] Starting...');

  // Initialize database
  console.log('[DB] Initializing database...');
  initDatabase();
  console.log('[DB] Database ready');

  // Start API server
  const server = await startServer();

  // Start indexer
  console.log('[Indexer] Starting blockchain indexer...');
  await startIndexer();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[Verus Platform] Received ${signal}, shutting down...`);
    
    stopIndexer();
    await server.close();
    
    console.log('[Verus Platform] Goodbye!');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[Verus Platform] Fatal error:', err);
  process.exit(1);
});
