/**
 * Auth Client
 */

import type { HttpClient } from '../core/http.js';
import type { AuthChallenge, Session, ApiResponse, Signer } from '../types/index.js';

export class AuthClient {
  constructor(
    private http: HttpClient,
    private signer?: Signer
  ) {}

  /**
   * Get a challenge to sign for login
   */
  async getChallenge(): Promise<ApiResponse<AuthChallenge>> {
    return this.http.get<ApiResponse<AuthChallenge>>('/v1/auth/challenge');
  }

  /**
   * Login with a signed challenge
   * Requires a signer to be set
   */
  async login(): Promise<ApiResponse<Session>> {
    if (!this.signer) {
      throw new Error('Signer required for login');
    }

    // Get challenge
    const { data: challengeData } = await this.getChallenge();
    
    // Sign the challenge
    const signature = await this.signer.sign(challengeData.challenge);
    
    // Submit login
    return this.http.post<ApiResponse<Session>>('/v1/auth/login', {
      verusId: this.signer.getVerusId(),
      signature,
    });
  }

  /**
   * Login with a pre-signed challenge
   */
  async loginWithSignature(
    verusId: string,
    signature: string
  ): Promise<ApiResponse<Session>> {
    return this.http.post<ApiResponse<Session>>('/v1/auth/login', {
      verusId,
      signature,
    });
  }

  /**
   * Get current session
   */
  async getSession(): Promise<ApiResponse<Session | null>> {
    try {
      return await this.http.get<ApiResponse<Session>>('/v1/auth/session');
    } catch (error) {
      return { data: null };
    }
  }

  /**
   * Check if currently authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    const { data } = await this.getSession();
    return data !== null;
  }

  /**
   * Logout and clear session
   */
  async logout(): Promise<void> {
    await this.http.post('/v1/auth/logout');
    this.http.clearSession();
  }
}
