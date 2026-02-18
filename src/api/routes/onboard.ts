/**
 * Onboarding Routes — Agent Identity Registration
 * 
 * POST /v1/onboard          — Register a new agent identity (subID under agentplatform@)
 * GET  /v1/onboard/status/:id — Check registration status
 * 
 * Flow:
 * 1. Agent generates keypair locally (WIF + R-address + pubkey)
 * 2. Agent POSTs name + address + pubkey + signature to /v1/onboard
 * 3. VAP validates name, verifies pubkey ownership, calls registernamecommitment
 * 4. After 1 block (~60s), VAP calls registeridentity
 * 5. Agent polls /v1/onboard/status/:id until status = 'registered'
 * 
 * Security:
 * - P2-SDK-4: Application-level name lock (DB unique index on pending names)
 * - P2-SDK-6: Pubkey signature verification (prove keypair ownership)
 * - Anti-squatting: Rate limits per IP
 * - Reserved names + homoglyph detection
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import * as secp256k1 from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import bs58check from 'bs58check';

// Configure @noble/secp256k1 v3 with sync hash functions
secp256k1.hashes.hmacSha256 = (key: Uint8Array, ...msgs: Uint8Array[]) => {
  const h = hmac.create(sha256, key);
  for (const msg of msgs) h.update(msg);
  return h.digest();
};
secp256k1.hashes.sha256 = (...msgs: Uint8Array[]) => {
  const h = sha256.create();
  for (const msg of msgs) h.update(msg);
  return h.digest();
};
import { getDatabase } from '../../db/index.js';
import { getRpcClient } from '../../indexer/rpc-client.js';
import { isReservedName } from '../../utils/reserved-names.js';
import { hasHomoglyphAttack } from '../../utils/homoglyph.js';
import { config } from '../../config/index.js';

// HMAC secret for challenge tokens (P2-SDK-12)
const CHALLENGE_SECRET = process.env.ONBOARD_CHALLENGE_SECRET || createHash('sha256').update(process.env.COOKIE_SECRET || 'dev-onboard-secret').digest('hex');
const CHALLENGE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Generate an HMAC challenge bound to name + address + timestamp.
 * No server-side state needed — recompute and verify on return.
 */
function generateChallenge(name: string, address: string): { challenge: string; token: string } {
  const timestamp = Date.now().toString();
  const nonce = uuidv4();
  const data = `${name}|${address}|${timestamp}|${nonce}`;
  const hmac = createHmac('sha256', CHALLENGE_SECRET).update(data).digest('hex');
  return {
    challenge: `vap-onboard:${nonce}`,
    token: `${timestamp}|${nonce}|${hmac}`,
  };
}

/**
 * Verify an HMAC challenge token. Returns true if valid and not expired.
 */
function verifyChallenge(name: string, address: string, challengeText: string, token: string): boolean {
  const parts = token.split('|');
  if (parts.length !== 3) return false;

  const [timestamp, nonce, hmac] = parts;
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Date.now() - ts > CHALLENGE_TTL) return false; // expired

  const data = `${name}|${address}|${timestamp}|${nonce}`;
  const expected = createHmac('sha256', CHALLENGE_SECRET).update(data).digest('hex');

  try {
    return timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Verify a signature over a challenge message using Verus RPC verifymessage.
 * Works with both base64 (from signmessage RPC / Verus Mobile) and SDK signatures.
 * Falls back to local secp256k1 if RPC is unavailable.
 */
async function verifyOnboardSignatureViaRPC(address: string, challenge: string, signature: string, pubkey?: string): Promise<boolean> {
  // Try RPC verifymessage first (works with Verus CLI / Mobile signatures)
  try {
    const rpc = getRpcClient();
    const result = await rpc.verifyMessage(address, challenge, signature);
    if (result === true) return true;
  } catch {
    // RPC unavailable or error — fall through to local verification
  }

  // Fall back to local verification for SDK-generated signatures
  if (pubkey) {
    try {
      console.log('[Onboard] RPC verify failed, trying local verification...');
      const localResult = verifySignatureLocally(address, challenge, signature, pubkey);
      console.log('[Onboard] Local verify result:', localResult);
      return localResult;
    } catch (e) {
      console.error('[Onboard] Local verify threw:', e);
      return false;
    }
  }

  return false;
}

/**
 * Verify an SDK-generated signature locally.
 * The SDK uses IdentitySignature from @bitgo/utxo-lib (VerusCoin fork)
 * which hashes as: SHA256(prefix + chainIdHash + blockHeight(4) + identityHash + SHA256(varint(msgLen) + lowercase(msg)))
 * We verify by recovering the pubkey from the compact signature and checking it matches.
 */
export function verifySignatureLocally(address: string, message: string, signature: string, pubkeyHex: string): boolean {
  try {
    const sigBuf = Buffer.from(signature, 'base64');
    if (sigBuf.length !== 65) return false;

    const expectedPubkey = Buffer.from(pubkeyHex, 'hex');

    // Reconstruct the message hash the same way IdentitySignature.hashMessage does:
    // 1. VERUS_DATA_SIGNATURE_PREFIX = writeVarSlice("Verus signed data:\n") = varint(19) + "Verus signed data:\n"
    const prefixStr = 'Verus signed data:\n';
    const prefix = Buffer.concat([Buffer.from([prefixStr.length]), Buffer.from(prefixStr)]);

    // 2. chainId hash (20 bytes from base58check decode of chain i-address)
    //    VRSCTEST = iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq
    const chainIdDecoded = bs58check.decode('iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq');
    const chainIdHash = chainIdDecoded.slice(1); // skip version byte

    // 3. blockHeight = 0 (4 bytes LE)
    const heightBuf = Buffer.alloc(4, 0);

    // 4. identity hash — SDK uses chainId as iAddress too
    const identityHash = chainIdHash;

    // 5. SHA256(varint(msgLen) + lowercase(msg))
    const lowerMsg = Buffer.from(message.toLowerCase(), 'utf8');
    // P2-SV-1: Guard against messages >= 253 bytes (varint encoding changes)
    if (lowerMsg.length >= 0xfd) throw new Error('Challenge too long for single-byte varint');
    const msgSlice = Buffer.concat([Buffer.from([lowerMsg.length]), lowerMsg]);
    const msgHash = createHash('sha256').update(msgSlice).digest();

    // 6. Final hash = SHA256(prefix + chainIdHash + heightBuf + identityHash + msgHash)
    const finalHash = createHash('sha256')
      .update(prefix)
      .update(chainIdHash)
      .update(heightBuf)
      .update(identityHash)
      .update(msgHash)
      .digest();

    // 7. Recover pubkey from compact signature using @noble/secp256k1 (P1-SV-1 fix)
    // Bitcoin compact sig format: byte 0 = recovery + 27 + (compressed ? 4 : 0)
    const recoveryFlag = sigBuf[0];
    const compressed = recoveryFlag >= 31;
    const recoveryId = compressed ? recoveryFlag - 31 : recoveryFlag - 27;
    if (recoveryId < 0 || recoveryId > 3) return false;

    // Build noble-compatible 65-byte sig: [recoveryId(0-3), r(32), s(32)]
    const nobleSig = Buffer.alloc(65);
    nobleSig[0] = recoveryId;
    sigBuf.copy(nobleSig, 1, 1, 65);

    const recovered = secp256k1.recoverPublicKey(nobleSig, finalHash, { prehash: false });

    return Buffer.from(recovered).equals(expectedPubkey);
  } catch (e) {
    console.error('[Onboard] Local signature verification error:', e);
    return false;
  }
}

// Rate limiting: 1 registration per IP per hour
const ipRegistrations = new Map<string, { count: number; resetAt: number }>();
const IP_LIMIT = parseInt(process.env.ONBOARD_IP_LIMIT || '5', 10); // 5/IP/hour default
const IP_WINDOW = 60 * 60 * 1000; // 1 hour

// Global daily limit
let dailyCount = 0;
let dailyResetAt = Date.now() + 24 * 60 * 60 * 1000;
const DAILY_LIMIT = 10;

// Cleanup rate limit entries
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of ipRegistrations.entries()) {
    if (entry.resetAt < now) ipRegistrations.delete(key);
  }
  if (now > dailyResetAt) {
    dailyCount = 0;
    dailyResetAt = now + 24 * 60 * 60 * 1000;
  }
}, 5 * 60 * 1000);

// Validation
const NAME_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
const ADDRESS_REGEX = /^R[1-9A-HJ-NP-Za-km-z]{25,34}$/;
const PUBKEY_REGEX = /^(02|03)[0-9a-fA-F]{64}$/;
const HEX64_REGEX = /^[0-9a-fA-F]{64}$/;

// The parent identity that registers subIDs
const PARENT_IDENTITY = 'agentplatform@';
const PARENT_IADDRESS = process.env.PARENT_IADDRESS || 'i7xKUpKQDSriYFfgHYfRpFc2uzRKWLDkjW'; // agentplatform@ i-address (P3-OB-3)
const PLATFORM_WALLET_ADDRESS = process.env.PLATFORM_WALLET_ADDRESS || 'RAWwNeTLRg9urgnDPQtPyZ6NRycsmSY2J2'; // Platform's daemon wallet address for controladdress

export async function onboardRoutes(fastify: FastifyInstance): Promise<void> {
  const rpc = getRpcClient();
  const db = getDatabase();

  // Cleanup stale pending registrations (P3: 30-minute timeout)
  const cleanupStale = db.prepare(`
    UPDATE onboard_requests SET status = 'failed', error = 'Timed out', updated_at = datetime('now')
    WHERE status IN ('pending', 'committing', 'confirming')
    AND created_at < datetime('now', '-30 minutes')
  `);

  // Run on startup and every 5 minutes
  cleanupStale.run();
  setInterval(() => cleanupStale.run(), 5 * 60 * 1000);

  // Prepared statements
  const insertOnboard = db.prepare(`
    INSERT INTO onboard_requests (id, name, address, pubkey, status, ip_address)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `);

  const getOnboard = db.prepare(`
    SELECT * FROM onboard_requests WHERE id = ?
  `);

  const getOnboardByName = db.prepare(`
    SELECT id FROM onboard_requests WHERE name = ? AND status IN ('pending', 'committing', 'confirming')
  `);

  const updateOnboardStatus = db.prepare(`
    UPDATE onboard_requests SET status = ?, updated_at = datetime('now') WHERE id = ?
  `);

  const updateOnboardCommit = db.prepare(`
    UPDATE onboard_requests SET status = 'committing', commitment_txid = ?, updated_at = datetime('now') WHERE id = ?
  `);

  const updateOnboardRegistered = db.prepare(`
    UPDATE onboard_requests SET status = 'registered', register_txid = ?, identity_name = ?, i_address = ?, updated_at = datetime('now') WHERE id = ?
  `);

  const updateOnboardFailed = db.prepare(`
    UPDATE onboard_requests SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?
  `);

  // ------------------------------------------
  // POST /v1/onboard
  // Register a new agent identity
  // ------------------------------------------
  fastify.post('/v1/onboard', {
    config: {
      rateLimit: { max: 20, timeWindow: 3600_000 }, // 20/hour outer limit
    },
  }, async (request, reply) => {
    const { name, address, pubkey, signature, challenge } = request.body as {
      name?: string;
      address?: string;
      pubkey?: string;
      signature?: string;
      challenge?: string;
    };

    // --- Input validation ---
    if (!name || !address) {
      return reply.code(400).send({
        error: { code: 'MISSING_FIELDS', message: 'name and address are required' },
      });
    }

    if (!NAME_REGEX.test(name)) {
      return reply.code(400).send({
        error: { code: 'INVALID_NAME', message: 'Name must be 1-64 alphanumeric characters, hyphens, or underscores' },
      });
    }

    if (!ADDRESS_REGEX.test(address)) {
      return reply.code(400).send({
        error: { code: 'INVALID_ADDRESS', message: 'Invalid R-address format' },
      });
    }

    if (pubkey && !PUBKEY_REGEX.test(pubkey)) {
      return reply.code(400).send({
        error: { code: 'INVALID_PUBKEY', message: 'Pubkey must be a 33-byte compressed secp256k1 key (hex)' },
      });
    }

    // --- P2-SDK-6: Verify pubkey ownership (if provided) ---
    // Agent must sign a challenge to prove they control the keypair
    if (!signature || !challenge) {
      // Generate an HMAC-bound challenge (P2-SDK-12: no server-side state needed)
      const { challenge: chalText, token } = generateChallenge(name, address);
      return reply.code(200).send({
        status: 'challenge',
        challenge: chalText,
        token,
        message: `Sign this challenge with your private key to prove ownership: ${chalText}`,
        signatureRequired: true,
      });
    }

    // Verify pubkey matches the claimed address (if pubkey provided)
    if (pubkey) {
      const derivedAddress = pubkeyToAddress(pubkey);
      if (derivedAddress !== address) {
        return reply.code(400).send({
          error: { code: 'PUBKEY_MISMATCH', message: 'Pubkey does not match the provided address' },
        });
      }
    }

    // Verify HMAC challenge token is valid and not expired (P2-SDK-12)
    const { token } = request.body as { token?: string };
    if (!token || !verifyChallenge(name, address, challenge, token)) {
      return reply.code(400).send({
        error: { code: 'INVALID_CHALLENGE', message: 'Challenge token is invalid or expired. Request a new challenge.' },
      });
    }

    // Verify signature via Verus RPC verifymessage (works with both RPC and SDK signatures)
    const sigValid = await verifyOnboardSignatureViaRPC(address, challenge, signature, pubkey);
    if (!sigValid) {
      return reply.code(400).send({
        error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed. Ensure you signed the exact challenge text with the correct private key.' },
      });
    }

    // --- Rate limiting ---
    const ip = request.ip;
    const now = Date.now();

    const ipEntry = ipRegistrations.get(ip);
    if (ipEntry && ipEntry.resetAt > now && ipEntry.count >= IP_LIMIT) {
      return reply.code(429).send({
        error: { code: 'RATE_LIMITED', message: `Maximum ${IP_LIMIT} registrations per IP per hour` },
      });
    }

    if (now > dailyResetAt) {
      dailyCount = 0;
      dailyResetAt = now + 24 * 60 * 60 * 1000;
    }
    if (dailyCount >= DAILY_LIMIT) {
      return reply.code(429).send({
        error: { code: 'DAILY_LIMIT', message: 'Daily registration limit reached. Try again tomorrow.' },
      });
    }

    // --- Name validation ---
    const lowerName = name.toLowerCase();

    if (isReservedName(lowerName)) {
      return reply.code(400).send({
        error: { code: 'RESERVED_NAME', message: 'This name is reserved and cannot be registered' },
      });
    }

    const homoglyphResult = hasHomoglyphAttack(name);
    if (homoglyphResult.isAttack) {
      return reply.code(400).send({
        error: { code: 'HOMOGLYPH_DETECTED', message: `Name may be confused with: ${homoglyphResult.confusedWith?.join(', ') || 'another name'}` },
      });
    }

    // --- P2-SDK-4: Check name lock (pending registrations) ---
    const existing = getOnboardByName.get(lowerName) as any;
    if (existing) {
      return reply.code(409).send({
        error: { code: 'NAME_IN_PROGRESS', message: 'This name is already being registered. Try a different name.' },
      });
    }

    // --- Check if name already exists on-chain ---
    try {
      const identity = await rpc.getIdentity(`${lowerName}.${PARENT_IDENTITY}`);
      if (identity?.identity) {
        return reply.code(409).send({
          error: { code: 'NAME_TAKEN', message: 'This name is already registered on the Verus blockchain' },
        });
      }
    } catch (error: any) {
      // "Identity not found" is expected — means the name is available
      if (!error.message.includes('Identity not found') && !error.message.includes('identity not found')) {
        console.error('[Onboard] RPC error checking identity:', error.message);
        return reply.code(502).send({
          error: { code: 'RPC_ERROR', message: 'Failed to check name availability' },
        });
      }
    }

    // --- Create onboard request (name lock) ---
    const onboardId = uuidv4();
    try {
      insertOnboard.run(onboardId, lowerName, address, pubkey || null, ip);
    } catch (error: any) {
      if (error.message.includes('UNIQUE constraint')) {
        return reply.code(409).send({
          error: { code: 'NAME_IN_PROGRESS', message: 'This name is already being registered' },
        });
      }
      throw error;
    }

    // Update rate limit counters
    if (ipEntry && ipEntry.resetAt > now) {
      ipEntry.count++;
    } else {
      ipRegistrations.set(ip, { count: 1, resetAt: now + IP_WINDOW });
    }
    dailyCount++;

    console.log(`[Onboard] New request: ${lowerName}.${PARENT_IDENTITY} → ${address} (${onboardId})`);

    // --- Start async registration process ---
    processRegistration(onboardId, lowerName, address, pubkey || '').catch(err => {
      console.error(`[Onboard] Registration failed for ${onboardId}:`, err.message);
      updateOnboardFailed.run(err.message, onboardId);
    });

    return reply.code(202).send({
      status: 'accepted',
      onboardId,
      name: lowerName,
      identity: `${lowerName}.${PARENT_IDENTITY}`,
      message: 'Registration started. Poll /v1/onboard/status/:id for updates. Expect ~60-120 seconds.',
    });
  });

  // ------------------------------------------
  // GET /v1/onboard/status/:id
  // Check registration status
  // ------------------------------------------
  fastify.get('/v1/onboard/status/:id', {
    config: {
      rateLimit: { max: 60, timeWindow: 60_000 },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const row = getOnboard.get(id) as any;
    if (!row) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Onboard request not found' },
      });
    }

    const response: any = {
      status: row.status,
      name: row.name,
      identity: `${row.name}.${PARENT_IDENTITY}`,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    if (row.status === 'registered') {
      response.iAddress = row.i_address;
      response.registerTxid = row.register_txid;
      if (row.funded_amount) {
        response.funded = { amount: row.funded_amount, currency: 'VRSCTEST', txid: row.fund_txid };
      }
    }

    if (row.status === 'failed') {
      response.error = row.error;
    }

    return reply.send(response);
  });

  // ------------------------------------------
  // POST /v1/onboard/retry/:id
  // Retry a failed registration that has a valid commitment TX
  // ------------------------------------------
  fastify.post('/v1/onboard/retry/:id', {
    config: { rateLimit: { max: 20, timeWindow: 3600_000 } },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = getOnboard.get(id) as any;

    if (!row) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Onboard request not found' } });
    }

    if (row.status !== 'failed') {
      return reply.code(400).send({ error: { code: 'NOT_FAILED', message: `Cannot retry — status is ${row.status}` } });
    }

    if (!row.commitment_txid) {
      return reply.code(400).send({ error: { code: 'NO_COMMITMENT', message: 'No commitment TX to resume from. Start a new registration.' } });
    }

    // Check if commitment is confirmed
    try {
      const tx = await rpc.rpcCall<any>('gettransaction', [row.commitment_txid]);
      if (!tx || tx.confirmations < 1) {
        return reply.code(400).send({ error: { code: 'NOT_CONFIRMED', message: 'Commitment TX not yet confirmed. Wait for a block and try again.' } });
      }
    } catch {
      return reply.code(400).send({ error: { code: 'TX_NOT_FOUND', message: 'Commitment TX not found on-chain' } });
    }

    // Get the namereservation from stored commitment data
    let commitData: any;
    if (row.commitment_data) {
      try {
        commitData = JSON.parse(row.commitment_data);
      } catch { /* corrupted data */ }
    }

    if (!commitData?.namereservation) {
      return reply.code(400).send({
        error: { code: 'NO_RESERVATION', message: 'Commitment data not stored (pre-retry feature). Start a new registration.' },
      });
    }

    const namereservation = commitData.namereservation;

    // Reset status and resume from registeridentity step
    db.prepare(`UPDATE onboard_requests SET status = 'confirming', error = NULL, updated_at = datetime('now') WHERE id = ?`).run(id);

    // Resume: call registeridentity directly
    const doRegister = async () => {
      console.log(`[Onboard] ${id}: Retrying registeridentity for "${row.name}"...`);
      const registerResult = await rpc.rpcCall('registeridentity', [{
        txid: row.commitment_txid,
        namereservation,
        identity: {
          name: row.name,
          parent: PARENT_IADDRESS,
          primaryaddresses: [row.address],
          minimumsignatures: 1,
        },
      }]);

      await sleep(5_000);
      let iAddress = '';
      try {
        const identity = await rpc.getIdentity(`${row.name}.${PARENT_IDENTITY}`);
        iAddress = identity?.identity?.identityaddress || '';
      } catch { iAddress = 'pending-lookup'; }

      const regTxid = typeof registerResult === 'string' ? registerResult : (registerResult as any)?.txid || '';
      updateOnboardRegistered.run(regTxid, `${row.name}.${PARENT_IDENTITY}`, iAddress, id);
      console.log(`[Onboard] ${id}: ✅ Retry registered ${row.name}.${PARENT_IDENTITY} (${iAddress})`);

      // Auto-fund
      const STARTUP_FUND = 0.0033;
      try {
        const fundTxid = await rpc.rpcCall<string>('sendtoaddress', [row.address, STARTUP_FUND]);
        db.prepare(`UPDATE onboard_requests SET funded_amount = ?, fund_txid = ? WHERE id = ?`).run(STARTUP_FUND, fundTxid, id);
      } catch { /* non-fatal */ }
    };

    doRegister().catch(err => {
      console.error(`[Onboard] Retry failed for ${id}:`, err.message);
      updateOnboardFailed.run(err.message, id);
    });

    return reply.code(202).send({
      status: 'retrying',
      onboardId: id,
      name: row.name,
      identity: `${row.name}.${PARENT_IDENTITY}`,
      message: 'Retrying registration from confirmed commitment. Poll /v1/onboard/status/:id for updates.',
    });
  });

  // ------------------------------------------
  // Async registration processor
  // ------------------------------------------
  async function processRegistration(
    onboardId: string,
    name: string,
    address: string,
    pubkey: string,
  ): Promise<void> {
    // Step 1: Register name commitment
    updateOnboardStatus.run('committing', onboardId);
    console.log(`[Onboard] ${onboardId}: Calling registernamecommitment for "${name}"...`);

    let commitResult: any;
    try {
      // registernamecommitment "name" "controladdress" "referralidentity" "parentnameorid"
      // controladdress must be in the daemon's wallet (agentplatform@ primary address)
      // We use the platform's address as control, then transfer ownership via registeridentity
      commitResult = await rpc.rpcCall('registernamecommitment', [
        name,              // name to register
        PLATFORM_WALLET_ADDRESS, // control address (must be in daemon wallet — LB-6)
        '',                // referral identity (empty)
        PARENT_IADDRESS,   // parent namespace (must use i-address, not friendly name)
      ]);
    } catch (error: any) {
      throw new Error(`Name commitment failed: ${error.message}`);
    }

    if (!commitResult?.txid) {
      throw new Error('Name commitment returned no txid');
    }

    updateOnboardCommit.run(commitResult.txid, onboardId);
    // Store full commitment data for retry capability
    db.prepare(`UPDATE onboard_requests SET commitment_data = ? WHERE id = ?`).run(JSON.stringify(commitResult), onboardId);
    console.log(`[Onboard] ${onboardId}: Commitment txid: ${commitResult.txid}`);

    // Step 2: Wait for 1 block confirmation
    updateOnboardStatus.run('confirming', onboardId);
    console.log(`[Onboard] ${onboardId}: Waiting for block confirmation...`);

    await waitForConfirmation(commitResult.txid, 300_000); // 5 min timeout (testnet blocks can be slow)

    // Step 3: Register identity
    console.log(`[Onboard] ${onboardId}: Calling registeridentity...`);

    let registerResult: any;
    try {
      // registeridentity takes a single JSON object param
      registerResult = await rpc.rpcCall('registeridentity', [{
        txid: commitResult.txid,
        namereservation: commitResult.namereservation,
        identity: {
          name: name,
          parent: PARENT_IADDRESS, // Required: parent namespace i-address
          primaryaddresses: [address],
          minimumsignatures: 1,
          // Revocation and recovery left blank — defaults to self (agent's own i-address)
          // Agent's human can later set themselves via updateidentity
        },
      }]);
    } catch (error: any) {
      throw new Error(`Identity registration failed: ${error.message}`);
    }

    // Step 4: Get the new identity's i-address with retry
    console.log(`[Onboard] ${onboardId}: Looking up i-address for ${name}.${PARENT_IDENTITY}...`);

    let iAddress = '';
    let iAddressAttempts = 0;
    const maxIAddressAttempts = 90; // 15 minutes total (10s * 90) for testnet with full blocks

    while (iAddressAttempts < maxIAddressAttempts) {
      try {
        const identity = await rpc.getIdentity(`${name}.${PARENT_IDENTITY}`);
        iAddress = identity?.identity?.identityaddress || '';
        if (iAddress) {
          console.log(`[Onboard] ${onboardId}: Got i-address: ${iAddress}`);
          break;
        }
      } catch (err: any) {
        // Identity not found yet - keep retrying
        if (!err.message?.includes('not found') && !err.message?.includes('Identity not found')) {
          console.warn(`[Onboard] ${onboardId}: RPC error getting identity: ${err.message}`);
        }
      }

      iAddressAttempts++;
      if (iAddressAttempts % 6 === 0) { // Log every minute
        console.log(`[Onboard] ${onboardId}: Still waiting for i-address... (${Math.round(iAddressAttempts * 10 / 60)}min elapsed)`);
      }
      await sleep(10_000);
    }

    if (!iAddress) {
      console.error(`[Onboard] ${onboardId}: Could not get i-address after ${maxIAddressAttempts} attempts (~15 min)`);
      iAddress = 'pending-lookup';
    }

    const registerTxid = typeof registerResult === 'string' ? registerResult : registerResult?.txid || '';
    updateOnboardRegistered.run(registerTxid, `${name}.${PARENT_IDENTITY}`, iAddress, onboardId);
    console.log(`[Onboard] ${onboardId}: ✅ Registered ${name}.${PARENT_IDENTITY} (${iAddress})`);

    // Step 5: Auto-fund the new agent with startup VRSCTEST
    // Enough for ~30+ contentmultimap updates
    const STARTUP_FUND = 0.0033;
    try {
      const fundTxid = await rpc.rpcCall<string>('sendtoaddress', [address, STARTUP_FUND]);
      console.log(`[Onboard] ${onboardId}: Funded ${address} with ${STARTUP_FUND} VRSCTEST (txid: ${fundTxid})`);
      // Track the funded amount for first-job recoup
      db.prepare(`UPDATE onboard_requests SET funded_amount = ?, fund_txid = ? WHERE id = ?`)
        .run(STARTUP_FUND, fundTxid, onboardId);
    } catch (fundError: any) {
      // Non-fatal — agent just won't have gas yet
      console.error(`[Onboard] ${onboardId}: Failed to fund: ${fundError.message}`);
    }
  }

  // Wait for a transaction to get at least 1 confirmation
  async function waitForConfirmation(txid: string, timeoutMs: number): Promise<void> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      try {
        const tx = await rpc.rpcCall<{ confirmations?: number }>('getrawtransaction', [txid, 1]);
        if (tx?.confirmations && tx.confirmations >= 1) {
          return;
        }
      } catch {
        // TX might not be indexed yet
      }

      await sleep(10_000); // Check every 10 seconds
    }

    throw new Error('Timed out waiting for block confirmation');
  }
}

// ------------------------------------------
// Helpers
// ------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Derive R-address from compressed public key.
 * Used to verify pubkey matches the claimed address (P2-SDK-6).
 */
function pubkeyToAddress(pubkeyHex: string): string {
  const pubkey = Buffer.from(pubkeyHex, 'hex');

  // Hash160: SHA256 → RIPEMD160
  const sha = createHash('sha256').update(pubkey).digest();
  const hash160 = createHash('ripemd160').update(sha).digest();

  // Verus/Komodo address version: 0x3C (60)
  const payload = Buffer.concat([Buffer.from([0x3c]), hash160]);

  // Base58Check
  const checksum = createHash('sha256')
    .update(createHash('sha256').update(payload).digest())
    .digest()
    .subarray(0, 4);

  return base58Encode(Buffer.concat([payload, checksum]));
}

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(buffer: Buffer): string {
  let zeros = 0;
  for (const byte of buffer) {
    if (byte === 0) zeros++;
    else break;
  }

  let num = BigInt('0x' + buffer.toString('hex'));
  const chars: string[] = [];
  while (num > 0n) {
    const remainder = Number(num % 58n);
    chars.unshift(ALPHABET[remainder]);
    num = num / 58n;
  }

  return '1'.repeat(zeros) + chars.join('');
}
