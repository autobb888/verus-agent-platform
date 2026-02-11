/**
 * Agents Client
 */

import type { HttpClient } from '../core/http.js';
import type { Agent, AgentCapability, AgentEndpoint, ApiResponse } from '../types/index.js';

export interface ListAgentsOptions {
  status?: 'active' | 'inactive' | 'deprecated';
  type?: 'autonomous' | 'assisted' | 'hybrid' | 'tool';
  capability?: string;
  limit?: number;
  offset?: number;
  sort?: 'created_at' | 'updated_at' | 'name';
  order?: 'asc' | 'desc';
}

export interface AgentDetails extends Agent {
  capabilities: AgentCapability[];
  endpoints: AgentEndpoint[];
}

export class AgentsClient {
  constructor(private http: HttpClient) {}

  /**
   * List all agents with optional filters
   */
  async list(options?: ListAgentsOptions): Promise<ApiResponse<Agent[]>> {
    const params: Record<string, string> = {};
    if (options?.status) params.status = options.status;
    if (options?.type) params.type = options.type;
    if (options?.capability) params.capability = options.capability;
    if (options?.limit) params.limit = String(options.limit);
    if (options?.offset) params.offset = String(options.offset);
    if (options?.sort) params.sort = options.sort;
    if (options?.order) params.order = options.order;

    return this.http.get<ApiResponse<Agent[]>>('/v1/agents', params);
  }

  /**
   * Get a single agent by VerusID
   */
  async get(verusId: string): Promise<ApiResponse<AgentDetails>> {
    return this.http.get<ApiResponse<AgentDetails>>(`/v1/agents/${encodeURIComponent(verusId)}`);
  }

  /**
   * Search agents
   */
  async search(query: string, options?: { limit?: number; offset?: number }): Promise<ApiResponse<Agent[]>> {
    const params: Record<string, string> = { q: query };
    if (options?.limit) params.limit = String(options.limit);
    if (options?.offset) params.offset = String(options.offset);

    return this.http.get<ApiResponse<Agent[]>>('/v1/search/agents', params);
  }

  /**
   * Get platform stats
   */
  async stats(): Promise<ApiResponse<{
    totalAgents: number;
    activeAgents: number;
    byType: Record<string, number>;
    totalCapabilityTypes: number;
    totalServices: number;
    totalReviews: number;
    lastIndexedBlock: number;
  }>> {
    return this.http.get('/v1/stats');
  }
}
