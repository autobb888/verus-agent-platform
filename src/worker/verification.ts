/**
 * Endpoint Verification Worker
 * 
 * Proves agents control claimed endpoints via challenge/response.
 * 
 * Flow:
 * 1. POST challenge token to {endpoint}/.well-known/verus-agent
 * 2. Wait 5 minutes
 * 3. GET {endpoint}/.well-known/verus-agent
 * 4. If token matches, mark verified
 * 
 * Shield AUTH-7: Abuse protection via retry limits and backoff
 */

import { randomBytes } from 'crypto';
import { getDatabase } from '../db/index.js';
import { ssrfSafeFetch } from '../utils/ssrf-fetch.js';

// Backoff delays in seconds (Shield AUTH-7)
const BACKOFF_DELAYS = [60, 300, 1800]; // 1min, 5min, 30min
const MAX_RETRIES = 3;
const VERIFICATION_INTERVAL_HOURS = 24;

export interface VerificationJob {
  verificationId: string;
  endpointId: string;
  agentId: string;
  url: string;
  verusId: string;
}

export interface VerificationResult {
  success: boolean;
  error?: string;
}

/**
 * Generate a cryptographically secure challenge token
 */
export function generateChallengeToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Create verification record for an endpoint
 */
export function createVerification(endpointId: string, agentId: string, url: string): string {
  const db = getDatabase();
  const id = randomBytes(16).toString('hex');
  const token = generateChallengeToken();
  
  db.prepare(`
    INSERT INTO endpoint_verifications 
    (id, endpoint_id, agent_id, url, challenge_token, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'))
  `).run(id, endpointId, agentId, url, token);
  
  return id;
}

/**
 * Step 1: Send challenge to endpoint
 */
export async function sendChallenge(job: VerificationJob): Promise<VerificationResult> {
  const db = getDatabase();
  
  // Get verification record
  const verification = db.prepare(
    'SELECT * FROM endpoint_verifications WHERE id = ?'
  ).get(job.verificationId) as any;
  
  if (!verification) {
    return { success: false, error: 'Verification not found' };
  }
  
  // Construct challenge URL
  const challengeUrl = new URL('/.well-known/verus-agent', job.url).toString();
  
  // Send challenge via POST
  const challengePayload = JSON.stringify({
    action: 'challenge',
    token: verification.challenge_token,
    verusId: job.verusId,
    timestamp: Math.floor(Date.now() / 1000),
    expiresAt: Math.floor(Date.now() / 1000) + 3600, // 1 hour expiry
  });
  
  console.log(`[Verification] Sending challenge to ${challengeUrl}`);
  
  const result = await ssrfSafeFetch(challengeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: challengePayload,
    timeout: 10000,
  });
  
  // Update attempt tracking
  db.prepare(`
    UPDATE endpoint_verifications 
    SET last_attempt_at = datetime('now'), retry_count = retry_count + 1
    WHERE id = ?
  `).run(job.verificationId);
  
  if (!result.ok) {
    const retryCount = verification.retry_count + 1;
    
    if (retryCount >= MAX_RETRIES) {
      // Mark as failed after max retries (Shield AUTH-7)
      db.prepare(`
        UPDATE endpoint_verifications 
        SET status = 'failed', error_message = ?
        WHERE id = ?
      `).run(result.error || 'Max retries exceeded', job.verificationId);
      
      return { success: false, error: `Failed after ${MAX_RETRIES} attempts: ${result.error}` };
    }
    
    // Schedule retry with backoff
    const delaySeconds = BACKOFF_DELAYS[Math.min(retryCount - 1, BACKOFF_DELAYS.length - 1)];
    
    db.prepare(`
      UPDATE endpoint_verifications 
      SET error_message = ?
      WHERE id = ?
    `).run(result.error, job.verificationId);
    
    console.log(`[Verification] Challenge failed, retry in ${delaySeconds}s: ${result.error}`);
    return { success: false, error: `Will retry in ${delaySeconds}s: ${result.error}` };
  }
  
  console.log('[Verification] Challenge sent successfully');
  return { success: true };
}

/**
 * Step 2: Verify the challenge response
 */
export async function verifyChallenge(job: VerificationJob): Promise<VerificationResult> {
  const db = getDatabase();
  
  // Get verification record
  const verification = db.prepare(
    'SELECT * FROM endpoint_verifications WHERE id = ?'
  ).get(job.verificationId) as any;
  
  if (!verification) {
    return { success: false, error: 'Verification not found' };
  }
  
  // Construct verification URL
  const verifyUrl = new URL('/.well-known/verus-agent', job.url).toString();
  
  console.log(`[Verification] Checking ${verifyUrl}`);
  
  const result = await ssrfSafeFetch(verifyUrl, {
    method: 'GET',
    timeout: 10000,
  });
  
  if (!result.ok) {
    db.prepare(`
      UPDATE endpoint_verifications 
      SET status = 'failed', error_message = ?, last_attempt_at = datetime('now')
      WHERE id = ?
    `).run(result.error || 'Verification request failed', job.verificationId);
    
    return { success: false, error: result.error };
  }
  
  // Parse response
  let response: any;
  try {
    response = JSON.parse(result.body);
  } catch {
    db.prepare(`
      UPDATE endpoint_verifications 
      SET status = 'failed', error_message = 'Invalid JSON response'
      WHERE id = ?
    `).run(job.verificationId);
    
    return { success: false, error: 'Invalid JSON response' };
  }
  
  // Check token matches
  if (response.token !== verification.challenge_token) {
    db.prepare(`
      UPDATE endpoint_verifications 
      SET status = 'failed', error_message = 'Token mismatch'
      WHERE id = ?
    `).run(job.verificationId);
    
    return { success: false, error: 'Token mismatch' };
  }
  
  // Check verusId matches (optional but recommended)
  if (response.verusId && response.verusId !== job.verusId) {
    db.prepare(`
      UPDATE endpoint_verifications 
      SET status = 'failed', error_message = 'VerusID mismatch'
      WHERE id = ?
    `).run(job.verificationId);
    
    return { success: false, error: 'VerusID mismatch' };
  }
  
  // Success! Mark as verified
  const nextVerification = new Date();
  nextVerification.setHours(nextVerification.getHours() + VERIFICATION_INTERVAL_HOURS);
  
  db.prepare(`
    UPDATE endpoint_verifications 
    SET status = 'verified', 
        verified_at = datetime('now'), 
        next_verification_at = ?,
        error_message = NULL,
        retry_count = 0
    WHERE id = ?
  `).run(nextVerification.toISOString(), job.verificationId);
  
  // Also update the endpoint record
  db.prepare(`
    UPDATE agent_endpoints SET verified = 1, verified_at = datetime('now')
    WHERE id = ?
  `).run(job.endpointId);
  
  console.log(`[Verification] SUCCESS: ${job.url} verified for ${job.verusId}`);
  return { success: true };
}

/**
 * Get endpoints due for re-verification
 */
export function getEndpointsDueForVerification(): VerificationJob[] {
  const db = getDatabase();
  
  const rows = db.prepare(`
    SELECT v.id as verificationId, v.endpoint_id, v.agent_id, v.url, a.verus_id
    FROM endpoint_verifications v
    JOIN agents a ON v.agent_id = a.id
    WHERE v.status = 'verified' 
      AND v.next_verification_at <= datetime('now')
  `).all() as any[];
  
  return rows.map(row => ({
    verificationId: row.verificationId,
    endpointId: row.endpoint_id,
    agentId: row.agent_id,
    url: row.url,
    verusId: row.verus_id,
  }));
}

/**
 * Get pending verifications that need challenge sent
 */
export function getPendingVerifications(): VerificationJob[] {
  const db = getDatabase();
  
  const rows = db.prepare(`
    SELECT v.id as verificationId, v.endpoint_id, v.agent_id, v.url, a.verus_id
    FROM endpoint_verifications v
    JOIN agents a ON v.agent_id = a.id
    WHERE v.status = 'pending'
      AND (v.last_attempt_at IS NULL OR 
           datetime(v.last_attempt_at, '+' || ? || ' seconds') <= datetime('now'))
  `).all(BACKOFF_DELAYS[0]) as any[];
  
  return rows.map(row => ({
    verificationId: row.verificationId,
    endpointId: row.endpoint_id,
    agentId: row.agent_id,
    url: row.url,
    verusId: row.verus_id,
  }));
}

/**
 * Mark stale verifications (failed re-verification)
 */
export function markStaleVerifications(): number {
  const db = getDatabase();
  
  // Mark as stale if missed 3 consecutive re-verifications
  const result = db.prepare(`
    UPDATE endpoint_verifications 
    SET status = 'stale'
    WHERE status = 'verified'
      AND next_verification_at <= datetime('now', '-72 hours')
  `).run();
  
  return result.changes;
}
