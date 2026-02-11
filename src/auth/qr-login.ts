/**
 * QR Code Login Flow
 * 
 * Generates VerusID login consent challenges that can be scanned
 * by Verus Mobile for passwordless authentication.
 * 
 * Flow:
 * 1. GET /auth/qr/challenge - Generate challenge, return QR code data
 * 2. User scans QR with Verus Mobile
 * 3. Mobile signs consent and POSTs to /auth/qr/callback
 * 4. Server verifies, creates session
 * 5. Frontend polls /auth/qr/status to detect login
 */

import { randomBytes } from 'crypto';
import * as QRCode from 'qrcode';
import { getDatabase } from '../db/index.js';

// QR challenge lifetime: 5 minutes
const QR_CHALLENGE_LIFETIME_MS = 5 * 60 * 1000;

// Poll interval for frontend
const POLL_INTERVAL_MS = 2000;

export interface QRChallenge {
  id: string;
  challenge: string;
  deeplink: string;
  qrDataUrl: string;
  expiresAt: number;
}

/**
 * Generate a human-readable challenge for QR login
 */
function generateChallengeMessage(nonce: string, timestamp: number): string {
  const date = new Date(timestamp).toISOString();
  return [
    'Verus Agent Platform',
    '====================',
    'Action: Login',
    `Timestamp: ${date}`,
    `Nonce: ${nonce}`,
    '',
    'Sign this message to authenticate.',
    'Do NOT sign if you did not initiate this request.',
  ].join('\n');
}

/**
 * Create a Verus Mobile deeplink for signing
 * 
 * Format: verus://sign/<base64_message>?callback=<webhook_url>
 * 
 * Note: This is a simplified deeplink. The full VerusID login consent
 * protocol uses a more complex structure, but this works for basic signing.
 */
function createVerusDeeplink(
  challengeId: string,
  message: string,
  callbackUrl: string
): string {
  // Base64 encode the message for URL safety
  const encodedMessage = Buffer.from(message).toString('base64url');
  
  // The callback URL where mobile will POST the signed response
  const callback = encodeURIComponent(`${callbackUrl}/auth/qr/callback?id=${challengeId}`);
  
  // Verus Mobile deeplink format
  return `verus://sign/${encodedMessage}?callback=${callback}`;
}

/**
 * Create a QR login challenge
 */
export async function createQRChallenge(callbackBaseUrl: string): Promise<QRChallenge> {
  const db = getDatabase();
  
  const id = randomBytes(16).toString('hex');
  const nonce = randomBytes(16).toString('hex');
  const now = Date.now();
  const expiresAt = now + QR_CHALLENGE_LIFETIME_MS;
  
  const challenge = generateChallengeMessage(nonce, now);
  const deeplink = createVerusDeeplink(id, challenge, callbackBaseUrl);
  
  // Generate QR code as data URL
  const qrDataUrl = await QRCode.toDataURL(deeplink, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 256,
    color: {
      dark: '#000000',
      light: '#ffffff',
    },
  });
  
  // Store challenge in database
  // status: 'pending' | 'signed' | 'expired'
  db.prepare(`
    INSERT INTO qr_challenges (id, challenge, deeplink, created_at, expires_at, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `).run(id, challenge, deeplink, now, expiresAt);
  
  return {
    id,
    challenge,
    deeplink,
    qrDataUrl,
    expiresAt,
  };
}

/**
 * Process a signed QR challenge callback from mobile
 */
export async function processQRCallback(
  challengeId: string,
  verusId: string,
  signature: string
): Promise<{ success: boolean; error?: string }> {
  const db = getDatabase();
  
  // Get the challenge
  const row = db.prepare(`
    SELECT id, challenge, expires_at, status
    FROM qr_challenges
    WHERE id = ?
  `).get(challengeId) as { id: string; challenge: string; expires_at: number; status: string } | undefined;
  
  if (!row) {
    return { success: false, error: 'Challenge not found' };
  }
  
  if (row.status !== 'pending') {
    return { success: false, error: 'Challenge already used' };
  }
  
  if (row.expires_at < Date.now()) {
    db.prepare(`UPDATE qr_challenges SET status = 'expired' WHERE id = ?`).run(challengeId);
    return { success: false, error: 'Challenge expired' };
  }
  
  // Store the signed response (signature verification happens in the route)
  db.prepare(`
    UPDATE qr_challenges 
    SET status = 'signed', verus_id = ?, signature = ?
    WHERE id = ?
  `).run(verusId, signature, challengeId);
  
  return { success: true };
}

/**
 * Check the status of a QR challenge (for polling)
 */
export function getQRChallengeStatus(challengeId: string): {
  status: 'pending' | 'signed' | 'expired' | 'not_found';
  verusId?: string;
  signature?: string;
  challenge?: string;
} {
  const db = getDatabase();
  
  const row = db.prepare(`
    SELECT status, verus_id, signature, challenge, expires_at
    FROM qr_challenges
    WHERE id = ?
  `).get(challengeId) as {
    status: string;
    verus_id: string | null;
    signature: string | null;
    challenge: string;
    expires_at: number;
  } | undefined;
  
  if (!row) {
    return { status: 'not_found' };
  }
  
  // Check if expired
  if (row.status === 'pending' && row.expires_at < Date.now()) {
    return { status: 'expired' };
  }
  
  return {
    status: row.status as 'pending' | 'signed' | 'expired',
    verusId: row.verus_id || undefined,
    signature: row.signature || undefined,
    challenge: row.challenge,
  };
}
