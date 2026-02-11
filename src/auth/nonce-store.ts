/**
 * Nonce Store - Prevents replay attacks
 * 
 * Primary: In-memory Map (for dev) / Redis (for prod)
 * Backup: SQLite/PostgreSQL for durability
 * 
 * Shield AUTH-2: TTL matches timestamp window + buffer (10 min total)
 */

import { getDatabase } from '../db/index.js';

interface NonceEntry {
  nonce: string;
  expiresAt: number; // Unix timestamp ms
  createdAt: number;
}

// In-memory store (replaced with Redis in prod)
const memoryStore = new Map<string, NonceEntry>();

// Cleanup interval (every 5 minutes)
const CLEANUP_INTERVAL = 5 * 60 * 1000;

// Initialize cleanup timer
let cleanupTimer: NodeJS.Timeout | null = null;

export function initNonceStore(): void {
  // Start cleanup timer
  if (!cleanupTimer) {
    cleanupTimer = setInterval(cleanupExpiredNonces, CLEANUP_INTERVAL);
  }
  
  // Ensure database table exists
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS used_nonces (
      nonce TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_nonces_expires ON used_nonces(expires_at);
  `);
  
  console.log('[NonceStore] Initialized');
}

export async function hasNonce(nonce: string): Promise<boolean> {
  // Check memory first
  if (memoryStore.has(nonce)) {
    const entry = memoryStore.get(nonce)!;
    if (entry.expiresAt > Date.now()) {
      return true;
    }
    // Expired, clean up
    memoryStore.delete(nonce);
  }
  
  // Check database backup
  const db = getDatabase();
  const row = db.prepare(
    'SELECT nonce FROM used_nonces WHERE nonce = ? AND expires_at > ?'
  ).get(nonce, Date.now());
  
  return row !== undefined;
}

/**
 * Atomically claim a nonce (Shield RACE-1 fix)
 * Returns true if claimed successfully, false if already exists
 */
export async function claimNonce(nonce: string, ttlMs: number = 600000): Promise<boolean> {
  const now = Date.now();
  const expiresAt = now + ttlMs;
  
  const db = getDatabase();
  
  try {
    // INSERT OR IGNORE returns changes=0 if nonce already exists
    // This is atomic - no race condition
    const result = db.prepare(
      'INSERT OR IGNORE INTO used_nonces (nonce, expires_at, created_at) VALUES (?, ?, ?)'
    ).run(nonce, expiresAt, now);
    
    if (result.changes === 0) {
      // Nonce already existed
      return false;
    }
    
    // Successfully claimed - also store in memory for fast lookups
    memoryStore.set(nonce, { nonce, expiresAt, createdAt: now });
    return true;
    
  } catch (error) {
    console.error('[NonceStore] Failed to claim nonce:', error);
    return false;
  }
}

export async function storeNonce(nonce: string, ttlMs: number = 600000): Promise<void> {
  const now = Date.now();
  const expiresAt = now + ttlMs;
  
  const entry: NonceEntry = {
    nonce,
    expiresAt,
    createdAt: now,
  };
  
  // Store in memory
  memoryStore.set(nonce, entry);
  
  // Store in database backup (Shield AUTH-2)
  const db = getDatabase();
  db.prepare(
    'INSERT OR REPLACE INTO used_nonces (nonce, expires_at, created_at) VALUES (?, ?, ?)'
  ).run(nonce, expiresAt, now);
}

function cleanupExpiredNonces(): void {
  const now = Date.now();
  
  // Clean memory store
  let memoryCleanedCount = 0;
  for (const [nonce, entry] of memoryStore.entries()) {
    if (entry.expiresAt <= now) {
      memoryStore.delete(nonce);
      memoryCleanedCount++;
    }
  }
  
  // Clean database
  const db = getDatabase();
  const result = db.prepare('DELETE FROM used_nonces WHERE expires_at <= ?').run(now);
  
  if (memoryCleanedCount > 0 || result.changes > 0) {
    console.log(`[NonceStore] Cleaned ${memoryCleanedCount} memory, ${result.changes} database nonces`);
  }
}

export function shutdownNonceStore(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
