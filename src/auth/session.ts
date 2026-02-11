/**
 * Session Management
 * 
 * Secure session handling for dashboard auth.
 * Shield: HttpOnly, Secure, SameSite=Strict, 1-hour lifetime
 */

import { randomBytes } from 'crypto';
import { getDatabase } from '../db/index.js';

const SESSION_LIFETIME_MS = 60 * 60 * 1000; // 1 hour
const SESSION_TOKEN_BYTES = 32;

export interface Session {
  id: string;
  token: string;
  verusId: string;
  identityAddress: string;
  createdAt: Date;
  expiresAt: Date;
  lastActivity: Date;
}

/**
 * Initialize sessions table
 */
export function initSessionsTable(): void {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      verus_id TEXT NOT NULL,
      identity_address TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_activity TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  `);
}

/**
 * Generate a secure session token
 */
export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('hex');
}

/**
 * Create a new session
 */
export function createSession(verusId: string, identityAddress: string): Session {
  const db = getDatabase();
  const id = randomBytes(16).toString('hex');
  const token = generateSessionToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);
  
  db.prepare(`
    INSERT INTO sessions (id, token, verus_id, identity_address, created_at, expires_at, last_activity)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    token,
    verusId,
    identityAddress,
    now.toISOString(),
    expiresAt.toISOString(),
    now.toISOString()
  );
  
  return {
    id,
    token,
    verusId,
    identityAddress,
    createdAt: now,
    expiresAt,
    lastActivity: now,
  };
}

/**
 * Get session by token
 */
export function getSessionByToken(token: string): Session | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token) as any;
  
  if (!row) return null;
  
  const session: Session = {
    id: row.id,
    token: row.token,
    verusId: row.verus_id,
    identityAddress: row.identity_address,
    createdAt: new Date(row.created_at),
    expiresAt: new Date(row.expires_at),
    lastActivity: new Date(row.last_activity),
  };
  
  // Check if expired
  if (session.expiresAt < new Date()) {
    deleteSession(token);
    return null;
  }
  
  return session;
}

/**
 * Update session last activity (extends session on activity)
 */
export function touchSession(token: string): void {
  const db = getDatabase();
  const now = new Date();
  const newExpiry = new Date(now.getTime() + SESSION_LIFETIME_MS);
  
  db.prepare(`
    UPDATE sessions SET last_activity = ?, expires_at = ? WHERE token = ?
  `).run(now.toISOString(), newExpiry.toISOString(), token);
}

/**
 * Delete a session (logout)
 */
export function deleteSession(token: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/**
 * Delete all sessions for a user
 */
export function deleteAllUserSessions(identityAddress: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM sessions WHERE identity_address = ?').run(identityAddress);
}

/**
 * Cleanup expired sessions
 */
export function cleanupExpiredSessions(): number {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM sessions WHERE expires_at < datetime(\'now\')').run();
  return result.changes;
}

/**
 * Cookie options for session token
 */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/',
  maxAge: SESSION_LIFETIME_MS / 1000, // seconds
};
