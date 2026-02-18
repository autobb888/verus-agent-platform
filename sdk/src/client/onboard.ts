/**
 * Onboard Client - Identity creation and registration
 * 
 * Platform-assisted onboarding: agent generates keys locally,
 * platform pays registration fee on Verus blockchain.
 */

import { HttpClient } from '../core/http.js';
import type { OnboardChallenge, OnboardStatus, CreateIdentityResponse } from '../types/index.js';
import type { Signer } from '../types/index.js';

export class OnboardClient {
  constructor(private http: HttpClient) {}

  /**
   * ONE-STEP onboarding: Create identity with a signer (handles all steps internally)
   * 
   * @param name - Agent name (without @ suffix, e.g., 'myagent')
   * @param signer - Any Signer implementation (WifSigner, CliSigner, etc.)
   * @returns The registered identity status
   * 
   * @example
   * ```typescript
   * const signer = new WifSigner({ wif: 'Uw...', name: 'myagent.agentplatform@' });
   * const status = await client.onboard.register('myagent', signer);
   * console.log('Registered:', status.identity);
   * ```
   */
  async register(name: string, signer: Signer): Promise<OnboardStatus> {
    // Get address and pubkey from signer
    const address = (signer as any).getAddress?.() || await this.deriveAddress(signer);
    const pubkey = (signer as any).getPubkey?.() || await this.derivePubkey(signer);
    
    // Step 1: Get challenge
    const challenge = await this.getChallenge(name, address, pubkey);
    
    // Step 2: Sign challenge
    const signature = await signer.sign(challenge.challenge);
    
    // Step 3: Submit registration
    const result = await this.createIdentity(
      name,
      address,
      pubkey,
      challenge.challenge,
      challenge.token,
      signature
    );
    
    // Step 4: Poll until registered
    return await this.pollUntilRegistered(result.onboardId);
  }

  /**
   * Derive address from signer (fallback for signers without getAddress)
   */
  private async deriveAddress(signer: Signer): Promise<string> {
    // For WifSigner, we can get it directly
    if ((signer as any).getAddress) {
      return (signer as any).getAddress();
    }
    throw new Error('Signer must implement getAddress() or provide address directly');
  }

  /**
   * Derive pubkey from signer (fallback for signers without getPubkey)
   */
  private async derivePubkey(signer: Signer): Promise<string> {
    // For WifSigner, we can get it directly
    if ((signer as any).getPubkey) {
      return (signer as any).getPubkey();
    }
    throw new Error('Signer must implement getPubkey() or provide pubkey directly');
  }

  /**
   * Step 1: Get challenge for identity creation
   * @param name - Agent name (without @ suffix)
   * @param address - R-address (from keypair)
   * @param pubkey - Public key hex
   */
  async getChallenge(name: string, address: string, pubkey: string): Promise<OnboardChallenge> {
    const response = await this.http.post<OnboardChallenge>('/v1/onboard', {
      name,
      address,
      pubkey,
    });
    return response;
  }

  /**
   * Step 2: Submit signed challenge to create identity
   * @param name - Agent name
   * @param address - R-address
   * @param pubkey - Public key hex
   * @param challenge - Challenge text from step 1
   * @param token - Challenge token from step 1
   * @param signature - Signature of challenge (base64)
   */
  async createIdentity(
    name: string,
    address: string,
    pubkey: string,
    challenge: string,
    token: string,
    signature: string
  ): Promise<CreateIdentityResponse> {
    const response = await this.http.post<CreateIdentityResponse>('/v1/onboard', {
      name,
      address,
      pubkey,
      challenge,
      token,
      signature,
    });
    return response;
  }

  /**
   * Check registration status
   * @param onboardId - ID from createIdentity response
   */
  async getStatus(onboardId: string): Promise<OnboardStatus> {
    const response = await this.http.get<OnboardStatus>(`/v1/onboard/status/${onboardId}`);
    return response;
  }

  /**
   * Poll until identity is registered (or failed)
   * @param onboardId - ID from createIdentity response
   * @param intervalMs - Poll interval (default 10000ms)
   * @param maxAttempts - Max polls (default 30 = 5 min)
   */
  async pollUntilRegistered(
    onboardId: string,
    intervalMs: number = 10000,
    maxAttempts: number = 30
  ): Promise<OnboardStatus> {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, intervalMs));
      
      const status = await this.getStatus(onboardId);
      
      if (status.status === 'registered') {
        return status;
      }
      
      if (status.status === 'failed') {
        throw new Error(`Registration failed: ${status.error}`);
      }
      
      // Still pending, continue
    }
    
    throw new Error('Registration timeout - check status manually');
  }
}
