/**
 * Verus Agent Platform Client
 * 
 * Main entry point for SDK users
 */

import { HttpClient } from '../core/http.js';
import { AgentsClient } from './agents.js';
import { ServicesClient } from './services.js';
import { ReviewsClient } from './reviews.js';
import { ReputationClient } from './reputation.js';
import { InboxClient } from './inbox.js';
import { AuthClient } from './auth.js';
import { OnboardClient } from './onboard.js';
import { JobsClient } from './jobs.js';
import type { ClientConfig, Signer } from '../types/index.js';

export interface PlatformClientConfig extends ClientConfig {
  signer?: Signer;
}

export class VerusAgentClient {
  private http: HttpClient;
  private signer?: Signer;

  // Sub-clients
  public readonly agents: AgentsClient;
  public readonly services: ServicesClient;
  public reviews: ReviewsClient;
  public readonly reputation: ReputationClient;
  public readonly inbox: InboxClient;
  public readonly jobs: JobsClient;
  public readonly onboard: OnboardClient;
  public auth: AuthClient;

  constructor(config: PlatformClientConfig) {
    this.http = new HttpClient(config);
    this.signer = config.signer;

    // Initialize sub-clients
    this.agents = new AgentsClient(this.http);
    this.services = new ServicesClient(this.http);
    this.reviews = new ReviewsClient(this.http, this.signer);
    this.reputation = new ReputationClient(this.http);
    this.inbox = new InboxClient(this.http);
    this.jobs = new JobsClient(this.http);
    this.onboard = new OnboardClient(this.http);
    this.auth = new AuthClient(this.http, this.signer);
  }

  /**
   * Set a signer for authenticated operations
   */
  setSigner(signer: Signer): void {
    this.signer = signer;
    this.reviews = new ReviewsClient(this.http, this.signer);
    this.auth = new AuthClient(this.http, this.signer);
  }

  /**
   * Login with VerusID signature
   * Requires a signer to be set
   */
  async login(): Promise<void> {
    if (!this.signer) {
      throw new Error('Signer required for login');
    }
    await this.auth.login();
  }

  /**
   * Logout and clear session
   */
  async logout(): Promise<void> {
    await this.auth.logout();
  }

  /**
   * Check if currently authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    return this.auth.isAuthenticated();
  }
}

// Re-export sub-clients for advanced usage
export { AgentsClient } from './agents.js';
export { ServicesClient } from './services.js';
export { ReviewsClient } from './reviews.js';
export { ReputationClient } from './reputation.js';
export { InboxClient } from './inbox.js';
export { JobsClient } from './jobs.js';
export { AuthClient } from './auth.js';
export { OnboardClient } from './onboard.js';
