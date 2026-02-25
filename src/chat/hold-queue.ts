/**
 * Message Hold Queue (Phase 6c)
 * 
 * Shield requirement: "Automated systems can delay, only humans can permanently punish."
 * Blocked messages go to a hold queue — agents can request review.
 * Messages are NOT deleted — they're retrievable for appeals.
 */

import { getDatabase } from '../db/index.js';
import { randomUUID } from 'crypto';

export interface HeldMessage {
  id: string;
  job_id: string;
  sender_verus_id: string;
  content: string;
  safety_score: number;
  flags: string;            // JSON array of flag objects
  status: 'held' | 'released' | 'rejected' | 'expired';
  appeal_reason: string | null;
  reviewed_at: string | null;
  created_at: string;
}

/**
 * Hold a message that was blocked by output scanning.
 * Returns the hold queue ID.
 */
export function holdMessage(params: {
  jobId: string;
  senderVerusId: string;
  content: string;
  safetyScore: number;
  flags: Array<{ type: string; severity: string; detail: string }>;
}): string {
  const db = getDatabase();
  const id = randomUUID();

  db.prepare(`
    INSERT INTO message_hold_queue (id, job_id, sender_verus_id, content, safety_score, flags, status)
    VALUES (?, ?, ?, ?, ?, ?, 'held')
  `).run(
    id,
    params.jobId,
    params.senderVerusId,
    params.content,
    params.safetyScore,
    JSON.stringify(params.flags)
  );

  return id;
}

/**
 * Get held messages for a job (agent can see their own held messages).
 */
export function getHeldMessages(jobId: string, senderVerusId: string): HeldMessage[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM message_hold_queue 
    WHERE job_id = ? AND sender_verus_id = ? AND status = 'held'
    ORDER BY created_at DESC
  `).all(jobId, senderVerusId) as HeldMessage[];
}

/**
 * Agent appeals a held message.
 */
export function appealMessage(holdId: string, senderVerusId: string, reason: string): boolean {
  const db = getDatabase();
  const truncatedReason = reason.slice(0, 2000);
  const result = db.prepare(`
    UPDATE message_hold_queue
    SET appeal_reason = ?, status = 'held'
    WHERE id = ? AND sender_verus_id = ? AND status = 'held'
  `).run(truncatedReason, holdId, senderVerusId);
  return result.changes > 0;
}

/**
 * Release a held message (admin/platform review).
 * Shield SLA: 4h for P1, 24h for P2. Auto-release with warning if SLA missed.
 */
export function releaseMessage(holdId: string): HeldMessage | null {
  const db = getDatabase();
  const result = db.prepare(`
    UPDATE message_hold_queue 
    SET status = 'released', reviewed_at = datetime('now')
    WHERE id = ? AND status = 'held'
  `).run(holdId);
  
  if (result.changes === 0) return null;
  return db.prepare('SELECT * FROM message_hold_queue WHERE id = ?').get(holdId) as HeldMessage;
}

/**
 * Reject a held message (admin/platform review).
 */
export function rejectMessage(holdId: string): boolean {
  const db = getDatabase();
  const result = db.prepare(`
    UPDATE message_hold_queue 
    SET status = 'rejected', reviewed_at = datetime('now')
    WHERE id = ? AND status = 'held'
  `).run(holdId);
  return result.changes > 0;
}

/**
 * Auto-release messages past SLA deadline.
 * Shield: If platform can't review in time, release with warning flag.
 */
export function autoReleaseExpired(slaHours: number = 24): number {
  const db = getDatabase();
  const cutoff = new Date(Date.now() - slaHours * 60 * 60 * 1000).toISOString();
  
  const result = db.prepare(`
    UPDATE message_hold_queue 
    SET status = 'released', reviewed_at = datetime('now')
    WHERE status = 'held' AND created_at < ?
  `).run(cutoff);

  return result.changes;
}

/**
 * Count held messages for monitoring.
 */
export function getHoldQueueStats(): { total: number; held: number; released: number; rejected: number } {
  const db = getDatabase();
  const stats = db.prepare(`
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN status = 'held' THEN 1 END) as held,
      COUNT(CASE WHEN status = 'released' THEN 1 END) as released,
      COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected
    FROM message_hold_queue
  `).get() as { total: number; held: number; released: number; rejected: number };
  return stats;
}
