/**
 * Signature Verification Module
 * 
 * Implements self-sovereign authentication via VerusID signatures.
 * Reference: https://monkins1010.github.io/veruslogin/server-login/
 * 
 * Shield AUTH-1: Uses RFC 8785 JSON canonicalization for deterministic serialization
 */

import { canonicalize } from 'json-canonicalize';
import { createHash } from 'crypto';
import { getRpcClient } from '../indexer/rpc-client.js';
import { hasNonce, claimNonce } from './nonce-store.js';

// Timestamp window: 5 minutes
const TIMESTAMP_WINDOW_SEC = 300;

// Nonce TTL: 10 minutes (window + buffer) per Shield AUTH-2
const NONCE_TTL_MS = 600000;

export interface SignedPayload<T = unknown> {
  verusId: string;      // VerusID (e.g., "my-agent@")
  timestamp: number;    // Unix seconds
  nonce: string;        // UUID v4
  action: string;       // "register" | "update" | "deactivate"
  data: T;              // Action-specific payload
  signature: string;    // Verus signature
}

export interface VerificationResult {
  valid: boolean;
  error?: string;
  verusId?: string;
  identityAddress?: string;
}

/**
 * Verify a signed request payload
 * 
 * Steps:
 * 1. Check timestamp within window
 * 2. Check nonce not already used
 * 3. Construct canonical message
 * 4. Verify signature via Verus RPC
 * 5. Store nonce to prevent replay
 */
export async function verifySignedPayload<T>(
  payload: SignedPayload<T>
): Promise<VerificationResult> {
  const { verusId, timestamp, nonce, action, data, signature } = payload;
  
  // 1. Validate timestamp within window
  const now = Math.floor(Date.now() / 1000);
  const timeDiff = Math.abs(now - timestamp);
  
  if (timeDiff > TIMESTAMP_WINDOW_SEC) {
    return {
      valid: false,
      error: `Request expired. Timestamp ${timeDiff}s outside ${TIMESTAMP_WINDOW_SEC}s window`,
    };
  }
  
  // 2. Atomically claim nonce (Shield RACE-1 fix)
  // This prevents race conditions where two concurrent requests could both pass
  if (!await claimNonce(nonce, NONCE_TTL_MS)) {
    return {
      valid: false,
      error: 'Replay detected: nonce already used',
    };
  }
  
  // 3. Construct canonical message (Shield AUTH-1 + SIGN-1 fix)
  // Use full data in message for simpler frontend signing flow
  const messageObject = {
    verusId,
    timestamp,
    nonce,
    action,
    data,
  };
  
  const message = canonicalize(messageObject);
  
  // 4. Verify signature via Verus RPC
  const rpc = getRpcClient();
  
  try {
    // Resolve identity name to i-address for verification
    // (SDK signs with i-address, so we need to verify with i-address)
    let verifyIdentity = verusId;
    try {
      const identity = await rpc.getIdentity(verusId);
      if (identity?.identity?.identityaddress) {
        verifyIdentity = identity.identity.identityaddress;
      }
    } catch {
      // Identity not found — use verusId as-is (might be i-address already)
    }
    
    const valid = await rpc.verifyMessage(verifyIdentity, message, signature);
    
    if (!valid) {
      return {
        valid: false,
        error: 'Invalid signature',
      };
    }
    
    // Nonce already claimed atomically in step 2 (Shield RACE-1 fix)
    
    // Get identity address for linking (re-use if already fetched)
    let identityAddress = verifyIdentity;
    if (identityAddress === verusId) {
      // We didn't resolve to i-address earlier, fetch now
      try {
        const identity = await rpc.getIdentity(verusId);
        identityAddress = identity?.identity?.identityaddress || verusId;
      } catch {
        identityAddress = verusId;
      }
    }
    
    return {
      valid: true,
      verusId,
      identityAddress,
    };
    
  } catch (error) {
    console.error('[Auth] Signature verification error:', error);
    return {
      valid: false,
      error: 'Signature verification failed',
    };
  }
}

/**
 * Generate a human-readable challenge message for login/auth
 */
export function generateChallenge(
  action: string,
  nonce: string,
  domain: string = 'agents.verus.io'
): { message: string; timestamp: number; nonce: string } {
  const timestamp = Math.floor(Date.now() / 1000);
  
  const message = `Verus Agent Platform
====================
Action: ${action}
Domain: ${domain}
Timestamp: ${new Date(timestamp * 1000).toISOString()}
Nonce: ${nonce}

Sign this message to authenticate.
Do NOT sign if you did not initiate this request.`;

  return { message, timestamp, nonce };
}

/**
 * SHA256 hash helper
 */
function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Validate UUID v4 format
 */
export function isValidUuid(str: string): boolean {
  const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidV4Regex.test(str);
}

/**
 * Validate VerusID format (name@)
 */
export function isValidVerusId(str: string): boolean {
  // VerusID format: alphanumeric, dots, hyphens, ending with @
  // Min 1 char, max 64 chars before @
  const verusIdRegex = /^[a-zA-Z0-9][a-zA-Z0-9.\-]{0,62}[a-zA-Z0-9]?@$/;
  return verusIdRegex.test(str) || /^[a-zA-Z0-9]@$/.test(str);
}
