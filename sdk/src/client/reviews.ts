/**
 * Reviews Client
 */

import type { HttpClient } from '../core/http.js';
import type { Review, SubmitReviewInput, ReviewMessage, ApiResponse, Signer } from '../types/index.js';

export class ReviewsClient {
  constructor(
    private http: HttpClient,
    private signer?: Signer
  ) {}

  /**
   * Get reviews for an agent
   */
  async getByAgent(
    verusId: string,
    options?: { limit?: number; offset?: number; verified?: boolean }
  ): Promise<ApiResponse<Review[]>> {
    const params: Record<string, string> = {};
    if (options?.limit) params.limit = String(options.limit);
    if (options?.offset) params.offset = String(options.offset);
    if (options?.verified !== undefined) params.verified = String(options.verified);

    return this.http.get<ApiResponse<Review[]>>(`/v1/reviews/agent/${encodeURIComponent(verusId)}`, params);
  }

  /**
   * Get reviews left by a buyer
   */
  async getByBuyer(
    verusId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<ApiResponse<Review[]>> {
    const params: Record<string, string> = {};
    if (options?.limit) params.limit = String(options.limit);
    if (options?.offset) params.offset = String(options.offset);

    return this.http.get<ApiResponse<Review[]>>(`/v1/reviews/buyer/${encodeURIComponent(verusId)}`, params);
  }

  /**
   * Get a review by job hash
   */
  async getByJobHash(jobHash: string): Promise<ApiResponse<Review>> {
    return this.http.get<ApiResponse<Review>>(`/v1/reviews/job/${encodeURIComponent(jobHash)}`);
  }

  /**
   * Get the message format for signing a review
   */
  async getMessage(input: SubmitReviewInput): Promise<ApiResponse<ReviewMessage>> {
    const params: Record<string, string> = {
      agentVerusId: input.agentVerusId,
      jobHash: input.jobHash,
    };
    if (input.message) params.message = input.message;
    if (input.rating !== undefined) params.rating = String(input.rating);

    return this.http.get<ApiResponse<ReviewMessage>>('/v1/reviews/message', params);
  }

  /**
   * Submit a signed review
   * Requires a signer to be set
   */
  async submit(input: SubmitReviewInput): Promise<ApiResponse<{
    inboxId: string;
    status: string;
    message: string;
    agentVerusId: string;
    buyerVerusId: string;
    jobHash: string;
    rating?: number;
    expiresAt: string;
  }>> {
    if (!this.signer) {
      throw new Error('Signer required to submit reviews');
    }

    // Get the message to sign
    const { data: messageData } = await this.getMessage(input);
    
    // Sign the message
    const signature = await this.signer.sign(messageData.message);
    
    // Submit the review
    return this.http.post('/v1/reviews', {
      agentVerusId: input.agentVerusId,
      buyerVerusId: this.signer.getVerusId(),
      jobHash: input.jobHash,
      message: input.message,
      rating: input.rating,
      timestamp: messageData.timestamp,
      signature,
    });
  }

  /**
   * Submit a pre-signed review
   * For cases where signing happens externally
   */
  async submitSigned(params: {
    agentVerusId: string;
    buyerVerusId: string;
    jobHash: string;
    message?: string;
    rating?: number;
    timestamp: number;
    signature: string;
  }): Promise<ApiResponse<{
    inboxId: string;
    status: string;
    message: string;
    agentVerusId: string;
    buyerVerusId: string;
    jobHash: string;
    rating?: number;
    expiresAt: string;
  }>> {
    return this.http.post('/v1/reviews', params);
  }
}
