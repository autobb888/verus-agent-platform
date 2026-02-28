/**
 * Verification Worker Runner
 * 
 * Polls for verification jobs and processes them.
 * In production, replace with BullMQ for proper job queue.
 */

import {
  getPendingVerifications,
  getEndpointsDueForVerification,
  sendChallenge,
  verifyChallenge,
  markStaleVerifications,
  type VerificationJob,
} from './verification.js';
import { jobFileQueries } from '../db/index.js';
import { deleteFile as deleteStoredFile } from '../files/storage.js';

const POLL_INTERVAL = 30 * 1000; // 30 seconds
const CHALLENGE_VERIFY_DELAY = 5 * 60 * 1000; // 5 minutes

// Track challenges that are waiting to be verified
const pendingChallenges = new Map<string, { job: VerificationJob; sentAt: number }>();

let running = false;

/**
 * Process a single challenge-send job
 */
async function processChallengeSend(job: VerificationJob): Promise<void> {
  console.log(`[Worker] Processing challenge for ${job.url}`);
  
  const result = await sendChallenge(job);
  
  if (result.success) {
    // Schedule verification check in 5 minutes
    pendingChallenges.set(job.verificationId, {
      job,
      sentAt: Date.now(),
    });
  }
}

/**
 * Process a single verification check
 */
async function processVerification(job: VerificationJob): Promise<void> {
  console.log(`[Worker] Verifying ${job.url}`);
  await verifyChallenge(job);
}

/**
 * Main worker loop
 */
async function workerLoop(): Promise<void> {
  if (!running) return;
  
  try {
    // 1. Check pending challenges that are ready for verification
    const now = Date.now();
    for (const [verificationId, pending] of pendingChallenges.entries()) {
      if (now - pending.sentAt >= CHALLENGE_VERIFY_DELAY) {
        await processVerification(pending.job);
        pendingChallenges.delete(verificationId);
      }
    }
    
    // 2. Process new pending verifications (challenge send)
    const pendingJobs = getPendingVerifications();
    for (const job of pendingJobs.slice(0, 5)) { // Process max 5 at a time
      await processChallengeSend(job);
    }
    
    // 3. Process re-verifications (endpoints due for 24h check)
    const dueJobs = getEndpointsDueForVerification();
    for (const job of dueJobs.slice(0, 5)) {
      await processVerification(job);
    }
    
    // 4. Cleanup expired job files (Phase 6b)
    // Files auto-expire 30 days after job completion
    try {
      const expiredFiles = jobFileQueries.getExpiredJobFiles(30);
      if (expiredFiles.length > 0) {
        for (const file of expiredFiles) {
          await deleteStoredFile(file.storage_path);
          jobFileQueries.delete(file.id);
        }
        console.log(`[Worker] Cleaned up ${expiredFiles.length} expired job files`);
      }
    } catch (err) {
      console.error('[Worker] File cleanup error:', err);
    }

    // 5. Cleanup old notifications (Phase 6d)
    try {
      const { getDatabase } = await import('../db/index.js');
      const db = getDatabase();
      const result = db.prepare(`
        DELETE FROM notifications WHERE 
          (read = 1 AND created_at < datetime('now', '-7 days'))
          OR created_at < datetime('now', '-30 days')
      `).run();
      if (result.changes > 0) {
        console.log(`[Worker] Cleaned up ${result.changes} old notifications`);
      }
    } catch (err) {
      console.error('[Worker] Notification cleanup error:', err);
    }

    // 6. Mark stale verifications
    const staleCount = markStaleVerifications();
    if (staleCount > 0) {
      console.log(`[Worker] Marked ${staleCount} verifications as stale`);
    }
    
  } catch (error) {
    console.error('[Worker] Error in worker loop:', error);
  }
  
  // Schedule next iteration
  setTimeout(workerLoop, POLL_INTERVAL).unref();
}

/**
 * Start the verification worker
 */
export function startWorker(): void {
  if (running) {
    console.log('[Worker] Already running');
    return;
  }
  
  running = true;
  console.log('[Worker] Starting verification worker...');
  workerLoop();
}

/**
 * Stop the verification worker
 */
export function stopWorker(): void {
  running = false;
  pendingChallenges.clear();
  console.log('[Worker] Stopped');
}

/**
 * Get worker status
 */
export function getWorkerStatus(): {
  running: boolean;
  pendingChallenges: number;
} {
  return {
    running,
    pendingChallenges: pendingChallenges.size,
  };
}
