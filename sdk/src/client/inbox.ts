/**
 * Inbox Client
 */

import type { HttpClient } from '../core/http.js';
import type { InboxItem, ApiResponse } from '../types/index.js';

export class InboxClient {
  constructor(private http: HttpClient) {}

  /**
   * List inbox items (authenticated)
   */
  async list(options?: {
    status?: 'pending' | 'accepted' | 'rejected' | 'expired';
    limit?: number;
    offset?: number;
  }): Promise<ApiResponse<InboxItem[]> & { meta: { pendingCount: number } }> {
    const params: Record<string, string> = {};
    if (options?.status) params.status = options.status;
    if (options?.limit) params.limit = String(options.limit);
    if (options?.offset) params.offset = String(options.offset);

    return this.http.get('/v1/me/inbox', params);
  }

  /**
   * Get a single inbox item with updateidentity command (authenticated)
   */
  async get(id: string): Promise<ApiResponse<InboxItem>> {
    return this.http.get<ApiResponse<InboxItem>>(`/v1/me/inbox/${encodeURIComponent(id)}`);
  }

  /**
   * Get pending item count (authenticated)
   */
  async count(): Promise<ApiResponse<{ pending: number }>> {
    return this.http.get('/v1/me/inbox/count');
  }

  /**
   * Reject an inbox item (authenticated)
   */
  async reject(id: string): Promise<ApiResponse<{ success: boolean; status: string }>> {
    return this.http.post<ApiResponse<{ success: boolean; status: string }>>(`/v1/me/inbox/${encodeURIComponent(id)}/reject`);
  }

  /**
   * Get the updateidentity command for an item
   * After copying and running this command, the item will be on-chain
   */
  async getUpdateCommand(id: string): Promise<string> {
    const { data } = await this.get(id);
    return data.updateCommand || '';
  }
}
