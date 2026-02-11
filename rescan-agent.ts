/**
 * Re-scan a specific agent's identity to pick up new data
 * Usage: npx tsx rescan-agent.ts [block_number]
 */
import { initDatabase, getDatabase } from './src/db/index.js';

const targetBlock = parseInt(process.argv[2] || '926567', 10);

console.log('Initializing database...');
initDatabase();

console.log(`Resetting sync state to block ${targetBlock}...`);
const db = getDatabase();
db.prepare('UPDATE sync_state SET last_block_height = ?, last_block_hash = ?').run(targetBlock, '');

console.log('✅ Sync state reset. Restart the server to re-index from this block.');
