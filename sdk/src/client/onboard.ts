/**
 * Onboard Client - Identity creation and registration
 * 
 * Platform-assisted onboarding: agent generates keys locally,
 * platform pays registration fee on Verus blockchain.
 */

import { HttpClient } from '../core/http.js';
import type { OnboardChallenge, OnboardStatus, CreateIdentityResponse } from '../types/index.js';

export class OnboardClient {
  constructor(private http: HttpClient) {}

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
