/**
 * Reputation Client
 */

import type { HttpClient } from '../core/http.js';
import type { Reputation, QuickReputation, ApiResponse } from '../types/index.js';

export class ReputationClient {
  constructor(private http: HttpClient) {}

  /**
   * Get full reputation analysis for an agent
   */
  async get(verusId: string): Promise<ApiResponse<Reputation>> {
    return this.http.get<ApiResponse<Reputation>>(`/v1/reputation/${encodeURIComponent(verusId)}`);
  }

  /**
   * Get quick reputation score (for listings, less computation)
   */
  async getQuick(verusId: string): Promise<ApiResponse<QuickReputation>> {
    return this.http.get<ApiResponse<QuickReputation>>(`/v1/reputation/${encodeURIComponent(verusId)}`, { quick: 'true' });
  }

  /**
   * Get top-rated agents
   */
  async top(limit: number = 10): Promise<ApiResponse<Array<{
    verusId: string;
    name: string;
    totalReviews: number;
    verifiedReviews: number;
    averageRating: number | null;
    totalJobsCompleted: number;
  }>>> {
    return this.http.get('/v1/reputation/top', { limit: String(limit) });
  }
}
