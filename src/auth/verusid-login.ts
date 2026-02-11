/**
 * VerusID Login Consent Implementation
 * 
 * Uses verus-typescript-primitives to create proper login consent requests
 * that work with Verus Mobile.
 */

import { randomBytes } from 'crypto';
import { getRpcClient } from '../indexer/rpc-client.js';
import * as primitives from 'verus-typescript-primitives';

const {
  LoginConsentChallenge,
  LoginConsentRequest,
  LoginConsentResponse,
  RedirectUri,
  RequestedPermission,
  VerusIDSignature,
  LOGIN_CONSENT_WEBHOOK_VDXF_KEY,
  IDENTITY_AUTH_SIG_VDXF_KEY,
  toBase58Check,
} = primitives;

// @ts-ignore - Import from nested path
import { IDENTITY_VIEW } from 'verus-typescript-primitives/dist/vdxf/scopes.js';

// I-address version byte
const I_ADDR_VERSION = 102;

// Config from environment
const PLATFORM_SIGNING_ID = process.env.PLATFORM_SIGNING_ID || 'agentplatform@';
const PLATFORM_CHAIN = process.env.PLATFORM_CHAIN || 'vrsctest';
const PUBLIC_URL = process.env.PUBLIC_URL || 'http://localhost:3000';

// Testnet chain i-address (VRSCTEST)
const VRSCTEST_CHAIN_IADDRESS = 'iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq';

/**
 * Generate a random challenge ID (i-address format)
 */
function generateChallengeId(): string {
  const buf = randomBytes(20);
  return toBase58Check(buf, I_ADDR_VERSION);
}

/**
 * Create a signed login consent request
 */
export async function createLoginConsentRequest(): Promise<{
  request: InstanceType<typeof LoginConsentRequest>;
  challengeId: string;
  deeplink: string;
  expiresAt: number;
}> {
  const rpc = getRpcClient();
  
  // Generate unique challenge ID
  const challengeId = generateChallengeId();
  
  // Create the challenge
  const challenge = new LoginConsentChallenge({
    challenge_id: challengeId,
    requested_access: [
      new RequestedPermission(IDENTITY_VIEW.vdxfid),
    ],
    redirect_uris: [
      new RedirectUri(
        `${PUBLIC_URL}/v1/auth/qr/callback`,
        LOGIN_CONSENT_WEBHOOK_VDXF_KEY.vdxfid
      ),
    ],
    subject: [],
    provisioning_info: [],
    created_at: Math.floor(Date.now() / 1000),
  });

  // Get platform identity address
  const identity = await rpc.getIdentity(PLATFORM_SIGNING_ID);
  const signingIAddress = identity.identity.identityaddress;

  // Create the request (unsigned)
  const request = new LoginConsentRequest({
    system_id: VRSCTEST_CHAIN_IADDRESS,
    signing_id: signingIAddress,
    challenge: challenge,
  });

  // Get current block height for signing
  const blockchainInfo = await rpc.getBlockchainInfo();
  const blockHeight = blockchainInfo.blocks;

  // Get the challenge hash to sign
  const challengeHash = request.getChallengeHash(blockHeight);
  const hashHex = challengeHash.toString('hex');

  // Sign the hash using signdata RPC
  const signResult = await rpc.signData({
    address: PLATFORM_SIGNING_ID,
    datahash: hashHex,
  });

  if (!signResult.signature) {
    throw new Error('Failed to sign login consent request');
  }

  // Create the signature object
  const signature = new VerusIDSignature(
    { signature: signResult.signature },
    IDENTITY_AUTH_SIG_VDXF_KEY
  );

  // Attach signature to request
  request.signature = signature;

  // Generate the deeplink URI
  const deeplink = request.toWalletDeeplinkUri();

  // 5 minute expiry
  const expiresAt = Date.now() + 5 * 60 * 1000;

  return {
    request,
    challengeId,
    deeplink,
    expiresAt,
  };
}

/**
 * Verify a login consent response from Verus Mobile
 */
export async function verifyLoginConsentResponse(
  responseData: unknown
): Promise<{
  valid: boolean;
  signingId?: string;
  identityAddress?: string;
  challengeId?: string;
  error?: string;
}> {
  try {
    const rpc = getRpcClient();
    
    // Parse the response
    const response = new LoginConsentResponse(responseData as any);
    
    // Get the challenge ID from the response
    const challengeId = response.decision?.request?.challenge?.challenge_id;
    
    // Verify the signature using RPC
    // The response contains the user's signed decision
    const signingId = response.signing_id;
    
    // Get identity info
    const identity = await rpc.getIdentity(signingId);
    const identityAddress = identity.identity.identityaddress;
    
    // Verify signature using verifysignature RPC
    // This verifies the user actually signed the response
    const verifyResult = await rpc.verifySignature({
      address: signingId,
      vdxfdata: response.toBuffer().toString('base64'),
    });
    
    if (!verifyResult.valid) {
      return { valid: false, error: 'Signature verification failed' };
    }
    
    return {
      valid: true,
      signingId,
      identityAddress,
      challengeId,
    };
  } catch (error) {
    console.error('Login response verification failed:', error);
    return { 
      valid: false, 
      error: error instanceof Error ? error.message : 'Verification failed' 
    };
  }
}
