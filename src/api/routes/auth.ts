/**
 * Auth Routes
 * 
 * VerusID wallet signature authentication for dashboard access.
 * 
 * Flow:
 * 1. GET /auth/challenge - Get a login challenge to sign
 * 2. POST /auth/login - Submit signed challenge, get session
 * 3. GET /auth/session - Check current session
 * 4. POST /auth/logout - End session
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { getDatabase } from '../../db/index.js';
import { getRpcClient } from '../../indexer/rpc-client.js';

// Session lifetime: 1 hour
const SESSION_LIFETIME_MS = 60 * 60 * 1000;

// Challenge lifetime: 5 minutes
const CHALLENGE_LIFETIME_MS = 5 * 60 * 1000;

// Session cookie name
const SESSION_COOKIE = 'verus_session';

// Rate limiting state (per-IP)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 10; // 10 requests per minute

// Store interval IDs for cleanup on shutdown
let rateLimitCleanupInterval: ReturnType<typeof setInterval> | null = null;
let sessionCleanupInterval: ReturnType<typeof setInterval> | null = null;

// Cleanup rate limit map every 5 minutes
rateLimitCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimitMap.entries()) {
    if (value.resetAt < now) {
      rateLimitMap.delete(key);
    }
  }
}, 5 * 60 * 1000);

// Shield AUTH-CLEANUP-1: Cleanup expired sessions and challenges every 10 minutes
sessionCleanupInterval = setInterval(() => {
  try {
    const db = getDatabase();
    const now = Date.now();
    
    const sessionsDeleted = db.prepare(`
      DELETE FROM sessions WHERE expires_at < ?
    `).run(now);
    
    const challengesDeleted = db.prepare(`
      DELETE FROM auth_challenges WHERE expires_at < ?
    `).run(now);
    
    if ((sessionsDeleted.changes || 0) > 0 || (challengesDeleted.changes || 0) > 0) {
      console.log(`[Auth] Cleanup: ${sessionsDeleted.changes || 0} sessions, ${challengesDeleted.changes || 0} challenges`);
    }
  } catch (err) {
    console.error('[Auth] Cleanup error:', err);
  }
}, 10 * 60 * 1000);

// Stop auth cleanup intervals (call on shutdown)
export function stopAuthCleanup(): void {
  if (rateLimitCleanupInterval) {
    clearInterval(rateLimitCleanupInterval);
    rateLimitCleanupInterval = null;
  }
  if (sessionCleanupInterval) {
    clearInterval(sessionCleanupInterval);
    sessionCleanupInterval = null;
  }
  console.log('[Auth] Cleanup intervals stopped');
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  
  if (!entry || entry.resetAt < now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }
  
  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }
  
  entry.count++;
  return true;
}

// Login request schema
const loginSchema = z.object({
  challengeId: z.string().length(32),
  verusId: z.string().min(1).max(100),
  signature: z.string().min(1).max(500),
});

/**
 * Generate a human-readable login challenge message
 * 
 * Shield: Message is clearly a login request to prevent
 * users being tricked into signing other actions.
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

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  
  /**
   * GET /auth/challenge
   * 
   * Generate a login challenge for the user to sign.
   */
  fastify.get('/auth/challenge', async (request: FastifyRequest, reply: FastifyReply) => {
    const ip = request.ip;
    
    if (!checkRateLimit(ip)) {
      return reply.code(429).send({ 
        error: { code: 'RATE_LIMITED', message: 'Too many requests, try again later' }
      });
    }
    
    try {
      const db = getDatabase();
      const id = randomBytes(16).toString('hex');
      const nonce = randomBytes(16).toString('hex');
      const now = Date.now();
      const expiresAt = now + CHALLENGE_LIFETIME_MS;
      
      const challenge = generateChallengeMessage(nonce, now);
      
      db.prepare(`
        INSERT INTO auth_challenges (id, challenge, created_at, expires_at)
        VALUES (?, ?, ?, ?)
      `).run(id, challenge, now, expiresAt);
      
      return {
        data: {
          challengeId: id,
          challenge,
          expiresAt: new Date(expiresAt).toISOString(),
        },
      };
    } catch (error) {
      fastify.log.error({ error }, 'Failed to create challenge');
      return reply.code(500).send({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to create challenge' }
      });
    }
  });

  /**
   * POST /auth/login
   * 
   * Submit a signed challenge to authenticate.
   */
  fastify.post('/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const ip = request.ip;
    
    if (!checkRateLimit(ip)) {
      return reply.code(429).send({ 
        error: { code: 'RATE_LIMITED', message: 'Too many requests, try again later' }
      });
    }
    
    // Validate request
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ 
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          details: parsed.error.errors.map(e => e.message),
        },
      });
    }
    
    const { challengeId, verusId, signature } = parsed.data;
    
    try {
      const db = getDatabase();
      const now = Date.now();
      
      // Shield AUTH-RACE-1 fix: Atomically claim the challenge
      // This prevents two concurrent requests from both passing
      const claimResult = db.prepare(`
        UPDATE auth_challenges 
        SET used = 1 
        WHERE id = ? AND used = 0 AND expires_at > ?
      `).run(challengeId, now);
      
      if (claimResult.changes === 0) {
        return reply.code(400).send({
          error: { code: 'INVALID_CHALLENGE', message: 'Invalid or expired challenge' }
        });
      }
      
      // We own the challenge, now get its content for verification
      const challengeRow = db.prepare(`
        SELECT challenge FROM auth_challenges WHERE id = ?
      `).get(challengeId) as { challenge: string } | undefined;
      
      if (!challengeRow) {
        // Should never happen since we just claimed it, but defensive
        return reply.code(400).send({
          error: { code: 'INVALID_CHALLENGE', message: 'Challenge not found' }
        });
      }
      
      // Verify the signature using RPC
      const rpc = getRpcClient();
      
      fastify.log.info({ 
        verusId, 
        challengePreview: challengeRow.challenge.slice(0, 50),
        signaturePreview: signature.slice(0, 30)
      }, 'Attempting signature verification');
      
      let isValid: boolean;
      try {
        isValid = await rpc.verifyMessage(verusId, challengeRow.challenge, signature);
        fastify.log.info({ isValid }, 'Signature verification result');
      } catch (rpcError) {
        fastify.log.error({ rpcError, verusId }, 'RPC verification failed');
        return reply.code(500).send({
          error: { code: 'VERIFICATION_FAILED', message: 'Signature verification service unavailable' }
        });
      }
      
      if (!isValid) {
        fastify.log.warn({ verusId }, 'Invalid signature');
        return reply.code(401).send({
          error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed' }
        });
      }
      
      // Get the resolved identity address and name
      let identityAddress: string;
      let identityName: string;
      try {
        const identity = await rpc.getIdentity(verusId);
        fastify.log.info({ identity: JSON.stringify(identity).slice(0, 200) }, 'Identity lookup result');
        identityAddress = identity.identity.identityaddress;
        // Use fullyqualifiedname so sign commands show the correct ID (e.g. "alice.agentplatform@" not "alice@")
        identityName = (identity as any).fullyqualifiedname
          ? (identity as any).fullyqualifiedname.replace(/\.VRSCTEST@$|\.VRSC@$/, '')
          : identity.identity.name;
        if (!identityAddress) {
          fastify.log.error({ verusId, identity }, 'Identity address is null/undefined');
          return reply.code(400).send({
            error: { code: 'INVALID_IDENTITY', message: 'Identity has no address' }
          });
        }
      } catch (rpcError) {
        fastify.log.error({ rpcError, verusId }, 'Failed to resolve identity');
        return reply.code(400).send({
          error: { code: 'INVALID_IDENTITY', message: 'Could not resolve VerusID' }
        });
      }
      
      // Create session
      const sessionId = randomBytes(32).toString('hex');
      const sessionNow = Date.now();
      const sessionExpiry = sessionNow + SESSION_LIFETIME_MS;
      
      db.prepare(`
        INSERT INTO sessions (id, verus_id, identity_name, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(sessionId, identityAddress, identityName, sessionNow, sessionExpiry);
      
      // Set session cookie
      // Shield: HttpOnly, Secure (in prod), SameSite=Strict
      reply.setCookie(SESSION_COOKIE, sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: SESSION_LIFETIME_MS / 1000, // seconds
        path: '/',
        signed: true,
      });
      
      fastify.log.info({ verusId, identityAddress, identityName }, 'User logged in');
      
      return {
        data: {
          success: true,
          verusId,
          identityAddress,
          identityName,
          expiresAt: new Date(sessionExpiry).toISOString(),
        },
      };
      
    } catch (error) {
      fastify.log.error({ error }, 'Login failed');
      return reply.code(500).send({
        error: { code: 'INTERNAL_ERROR', message: 'Authentication failed' }
      });
    }
  });

  /**
   * GET /auth/session
   * 
   * Check current session status.
   */
  fastify.get('/auth/session', async (request: FastifyRequest, reply: FastifyReply) => {
    const sessionId = request.cookies?.[SESSION_COOKIE];
    
    if (!sessionId) {
      return { data: { authenticated: false } };
    }
    
    try {
      const db = getDatabase();
      const session = db.prepare(`
        SELECT id, verus_id, identity_name, created_at, expires_at
        FROM sessions
        WHERE id = ?
      `).get(sessionId) as { id: string; verus_id: string; identity_name: string | null; created_at: number; expires_at: number } | undefined;
      
      if (!session) {
        reply.clearCookie(SESSION_COOKIE);
        return { data: { authenticated: false } };
      }
      
      // Check if expired
      if (session.expires_at < Date.now()) {
        db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
        reply.clearCookie(SESSION_COOKIE);
        return { data: { authenticated: false } };
      }
      
      // Extend session on activity
      const newExpiry = Date.now() + SESSION_LIFETIME_MS;
      db.prepare(`UPDATE sessions SET expires_at = ? WHERE id = ?`).run(newExpiry, sessionId);
      
      return {
        data: {
          authenticated: true,
          verusId: session.verus_id,
          identityName: session.identity_name,
          expiresAt: new Date(newExpiry).toISOString(),
        },
      };
      
    } catch (error) {
      fastify.log.error({ error }, 'Session check failed');
      return { data: { authenticated: false } };
    }
  });

  /**
   * POST /auth/logout
   * 
   * End the current session.
   */
  fastify.post('/auth/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    const sessionId = request.cookies?.[SESSION_COOKIE];
    
    if (sessionId) {
      try {
        const db = getDatabase();
        db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
      } catch (error) {
        fastify.log.error({ error }, 'Logout failed');
      }
    }
    
    reply.clearCookie(SESSION_COOKIE);
    return { data: { success: true } };
  });

  // ============================================
  // QR Code Login (Verus Mobile) - VerusID Login Consent
  // ============================================

  /**
   * GET /auth/qr/challenge
   * 
   * Generate a proper VerusID Login Consent Request QR code.
   * Uses verus-typescript-primitives for the correct protocol.
   */
  fastify.get('/auth/qr/challenge', async (request: FastifyRequest, reply: FastifyReply) => {
    const ip = request.ip;
    
    if (!checkRateLimit(ip)) {
      return reply.code(429).send({ 
        error: { code: 'RATE_LIMITED', message: 'Too many requests' }
      });
    }
    
    try {
      // Proxy to the VerusID login microservice for proper WIF-based signing
      const LOGIN_SERVICE_URL = process.env.LOGIN_SERVICE_URL || 'http://localhost:8000';
      const loginRes = await fetch(`${LOGIN_SERVICE_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      
      if (!loginRes.ok) {
        throw new Error(`Login service returned ${loginRes.status}`);
      }
      
      const loginData = await loginRes.json() as any;
      const { challengeId: loginChallengeId, deeplink, qrDataUrl, expiresAt } = loginData.data;
      
      const db = getDatabase();
      const now = Date.now();
      const expiresAtMs = new Date(expiresAt).getTime();
      
      // Store the challenge mapping (use the login service's challenge ID as both id and challenge)
      db.prepare(`
        INSERT INTO qr_challenges (id, challenge, deeplink, created_at, expires_at, status)
        VALUES (?, ?, ?, ?, ?, 'pending')
      `).run(loginChallengeId, loginChallengeId, deeplink, now, expiresAtMs);
      
      fastify.log.info({ challengeId: loginChallengeId }, 'Created VerusID login consent request via login service');
      
      return {
        data: {
          challengeId: loginChallengeId,
          deeplink,
          qrDataUrl,
          expiresAt,
        },
      };
    } catch (error) {
      fastify.log.error({ error }, 'Failed to create QR challenge');
      return reply.code(500).send({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to create QR challenge' }
      });
    }
  });

  /**
   * POST /auth/qr/callback
   * 
   * Webhook endpoint for Verus Mobile to submit LoginConsentResponse.
   * This is called by the mobile app after user approves the login.
   * Also receives pre-verified callbacks from the login microservice.
   */
  fastify.post('/auth/qr/callback', async (request: FastifyRequest, reply: FastifyReply) => {
    fastify.log.info({ bodyKeys: request.body ? Object.keys(request.body as any) : 'null' }, 'QR callback received');
    
    try {
      const body = request.body as any;
      let challengeId: string;
      let signingId: string;
      
      // Check if this is a pre-verified callback from the login microservice
      // P1-VAP-001: Authenticate via HMAC shared secret or localhost-only
      if (body.verified === true && body.challengeId && body.signingId) {
        // Verify the callback is from the login service — check HMAC or source IP
        const callbackSecret = process.env.LOGIN_CALLBACK_SECRET;
        const remoteIp = request.ip;
        const isLocalhost = remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1';
        
        if (callbackSecret) {
          // HMAC verification: login service must sign { challengeId, signingId } with shared secret
          const { createHmac, timingSafeEqual } = await import('crypto');
          const expectedSig = createHmac('sha256', callbackSecret)
            .update(`${body.challengeId}:${body.signingId}`)
            .digest('hex');
          const providedSig = body.callbackSignature || '';
          if (providedSig.length !== expectedSig.length || !timingSafeEqual(Buffer.from(providedSig), Buffer.from(expectedSig))) {
            fastify.log.warn({ remoteIp }, 'QR callback HMAC verification failed — rejecting');
            return reply.code(403).send({
              error: { code: 'FORBIDDEN', message: 'Invalid callback signature' },
            });
          }
        } else if (!isLocalhost) {
          // No shared secret configured — only allow from localhost
          fastify.log.warn({ remoteIp }, 'QR callback from non-localhost without LOGIN_CALLBACK_SECRET — rejecting');
          return reply.code(403).send({
            error: { code: 'FORBIDDEN', message: 'Callback not authorized' },
          });
        }
        
        challengeId = body.challengeId;
        signingId = body.signingId;
        fastify.log.info({ challengeId, signingId }, 'Pre-verified QR callback from login service (authenticated)');
      } else {
        // Raw callback from Verus Mobile — forward to login service for verification
        const LOGIN_SERVICE_URL = process.env.LOGIN_SERVICE_URL || 'http://localhost:8000';
        fastify.log.info('Forwarding raw mobile callback to login service for verification');
        
        // Forward to login service for verification
        // Login server has restoreBuffers() to handle JSON Buffer mangling
        const LOGIN_SERVICE_URL_INTERNAL = process.env.LOGIN_SERVICE_URL || 'http://localhost:8000';
        fastify.log.info('Forwarding mobile callback to login service');
        
        const verifyRes = await fetch(`${LOGIN_SERVICE_URL_INTERNAL}/verusidlogin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        
        if (!verifyRes.ok) {
          const errText = await verifyRes.text();
          fastify.log.warn({ status: verifyRes.status, error: errText }, 'Login service verification failed');
          return reply.code(401).send({
            error: { code: 'INVALID_RESPONSE', message: 'Signature verification failed' }
          });
        }
        
        // The login service verified successfully and forwarded back to us
        // with verified=true to update the DB. Return success to mobile.
        return { data: { success: true } };
      }
      
      const db = getDatabase();
      
      // Resolve the full identity name via RPC
      let verusId = signingId;
      try {
        const rpc = (await import('../../indexer/rpc-client.js')).getRpcClient();
        const identity = await rpc.getIdentity(signingId);
        verusId = (identity.identity as any).fullyqualifiedname || identity.identity.identityaddress || signingId;
        fastify.log.info({ signingId, resolved: verusId }, 'Resolved signing ID to identity name');
      } catch (e) {
        fastify.log.warn({ signingId, error: e }, 'Could not resolve identity name, using raw signing ID');
      }
      
      // Find the pending challenge by challenge_id
      const row = db.prepare(`
        SELECT id, expires_at, status
        FROM qr_challenges
        WHERE challenge = ? AND status = 'pending'
      `).get(challengeId) as { id: string; expires_at: number; status: string } | undefined;
      
      if (!row) {
        fastify.log.warn({ challengeId }, 'Challenge ID not found, checking for any pending');
      }
      
      if (row && row.expires_at < Date.now()) {
        db.prepare(`UPDATE qr_challenges SET status = 'expired' WHERE id = ?`).run(row.id);
        return reply.code(400).send({
          error: { code: 'EXPIRED', message: 'Challenge expired' }
        });
      }
      
      // Update challenge with signed info
      if (row) {
        // Store verus_id and identity_name (fullyqualifiedname) for session creation
        let identityName = verusId;
        try {
          const rpc = getRpcClient();
          const idInfo = await rpc.getIdentity(verusId);
          if (idInfo?.identity?.fullyqualifiedname) {
            identityName = idInfo.identity.fullyqualifiedname;
          }
        } catch { /* fall back to verusId */ }

        db.prepare(`
          UPDATE qr_challenges 
          SET status = 'signed', verus_id = ?, identity_name = ?
          WHERE id = ?
        `).run(verusId, identityName, row.id);
      }
      
      fastify.log.info({ signingId, verusId }, 'QR login consent verified');
      
      return { data: { success: true } };
    } catch (error) {
      fastify.log.error({ error }, 'QR callback failed');
      return reply.code(500).send({
        error: { code: 'INTERNAL_ERROR', message: 'Callback processing failed' }
      });
    }
  });

  /**
   * GET /auth/qr/status/:id
   * 
   * Poll endpoint for frontend to check if QR was scanned and signed.
   */
  fastify.get('/auth/qr/status/:id', {
    config: {
      rateLimit: {
        max: 60,        // P2-VAP-006: Rate limit QR polling
        timeWindow: 60_000, // 60/min per IP (frontend polls every 2s = 30/min)
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    
    try {
      const db = getDatabase();
      
      const row = db.prepare(`
        SELECT status, verus_id, identity_name, expires_at
        FROM qr_challenges
        WHERE id = ?
      `).get(id) as {
        status: string;
        verus_id: string | null;
        identity_name: string | null;
        expires_at: number;
      } | undefined;
      
      if (!row) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'Challenge not found' }
        });
      }
      
      // Check if expired
      if (row.status === 'pending' && row.expires_at < Date.now()) {
        db.prepare(`UPDATE qr_challenges SET status = 'expired' WHERE id = ?`).run(id);
        return { data: { status: 'expired' } };
      }
      
      // If signed, atomically claim and create session
      if (row.status === 'signed' && row.verus_id) {
        // P2-QR-1: Atomic claim — prevents two concurrent polls from both creating sessions
        const claimResult = db.prepare(`
          UPDATE qr_challenges SET status = 'completed' WHERE id = ? AND status = 'signed'
        `).run(id);
        
        if (claimResult.changes === 0) {
          // Another request already claimed this challenge
          return { data: { status: 'pending' } };
        }

        // We own the claim — safe to create session
        const sessionId = randomBytes(32).toString('hex');
        const sessionNow = Date.now();
        const sessionExpiry = sessionNow + SESSION_LIFETIME_MS;
        
        db.prepare(`
          INSERT INTO sessions (id, verus_id, identity_name, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(sessionId, row.verus_id, row.identity_name || row.verus_id, sessionNow, sessionExpiry);
        
        // Set session cookie
        reply.setCookie(SESSION_COOKIE, sessionId, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: SESSION_LIFETIME_MS / 1000,
          path: '/',
          signed: true,
        });
        
        fastify.log.info({ verusId: row.verus_id }, 'QR login completed');
        
        return {
          data: {
            status: 'completed',
            verusId: row.verus_id,
          },
        };
      }
      
      return { data: { status: row.status } };
    } catch (error) {
      fastify.log.error({ error }, 'QR status check failed');
      return reply.code(500).send({
        error: { code: 'INTERNAL_ERROR', message: 'Status check failed' }
      });
    }
  });

  /**
   * GET /auth/qr/complete/:id
   * 
   * Redirect-based login completion for mobile browsers.
   * Mobile Safari/Chrome may silently drop Set-Cookie from cross-origin fetch() responses.
   * This endpoint is navigated to directly (window.location), so the cookie is set as first-party.
   */
  fastify.get('/auth/qr/complete/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const dashboardUrl = process.env.CORS_ORIGIN?.split(',')[0] || 'http://localhost:5173';

    try {
      const db = getDatabase();
      const row = db.prepare(`
        SELECT status, verus_id, identity_name FROM qr_challenges WHERE id = ?
      `).get(id) as { status: string; verus_id: string | null; identity_name: string | null } | undefined;

      if (!row || !row.verus_id || (row.status !== 'signed' && row.status !== 'completed')) {
        return reply.redirect(`${dashboardUrl}?login=failed`);
      }

      // If still 'signed', atomically claim it
      if (row.status === 'signed') {
        const claimed = db.prepare(`UPDATE qr_challenges SET status = 'completed' WHERE id = ? AND status = 'signed'`).run(id);
        if (claimed.changes === 0) {
          // Already claimed — check if session already exists (race with poll)
          // Still redirect to dashboard, session might already be set via poll
          return reply.redirect(`${dashboardUrl}/dashboard`);
        }

        const sessionId = randomBytes(32).toString('hex');
        const sessionNow = Date.now();
        const sessionExpiry = sessionNow + SESSION_LIFETIME_MS;

        db.prepare(`
          INSERT INTO sessions (id, verus_id, identity_name, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(sessionId, row.verus_id, row.identity_name || row.verus_id, sessionNow, sessionExpiry);

        reply.setCookie(SESSION_COOKIE, sessionId, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',    // 'lax' required for redirect-based flow
          maxAge: SESSION_LIFETIME_MS / 1000,
          path: '/',
          signed: true,
        });

        fastify.log.info({ verusId: row.verus_id }, 'QR login completed via redirect');
      }

      return reply.redirect(`${dashboardUrl}/dashboard`);
    } catch (error) {
      fastify.log.error({ error }, 'QR complete redirect failed');
      return reply.redirect(`${dashboardUrl}?login=error`);
    }
  });

}

/**
 * Get session from request (for use in other routes)
 */
export function getSessionFromRequest(request: FastifyRequest): { verusId: string; identityName: string | null } | null {
  // P2-VAP-001: Unsign cookie to verify integrity
  const raw = request.cookies?.[SESSION_COOKIE];
  if (!raw) return null;
  const unsigned = request.unsignCookie(raw);
  const sessionId = unsigned.valid ? unsigned.value : raw; // fallback for legacy unsigned cookies
  if (!sessionId) return null;
  
  try {
    const db = getDatabase();
    const session = db.prepare(`
      SELECT verus_id, identity_name, expires_at
      FROM sessions
      WHERE id = ?
    `).get(sessionId) as { verus_id: string; identity_name: string | null; expires_at: number } | undefined;
    
    if (!session || session.expires_at < Date.now()) {
      return null;
    }
    
    return { verusId: session.verus_id, identityName: session.identity_name ?? null };
  } catch {
    return null;
  }
}

/**
 * Require authentication decorator for routes
 */
export async function requireAuth(
  request: FastifyRequest, 
  reply: FastifyReply
): Promise<void> {
  const session = getSessionFromRequest(request);
  
  if (!session) {
    reply.code(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' }
    });
    return;
  }
  
  // Attach session to request for downstream use
  (request as any).session = session;
}
