/**
 * Services Client
 */

import type { HttpClient } from '../core/http.js';
import type { Service, CreateServiceInput, UpdateServiceInput, ApiResponse } from '../types/index.js';

export interface ListServicesOptions {
  agentId?: string;
  verusId?: string;
  category?: string;
  status?: 'active' | 'inactive' | 'deprecated';
  minPrice?: number;
  maxPrice?: number;
  limit?: number;
  offset?: number;
  sort?: 'created_at' | 'updated_at' | 'name' | 'price';
  order?: 'asc' | 'desc';
}

export class ServicesClient {
  constructor(private http: HttpClient) {}

  /**
   * List all services with optional filters
   */
  async list(options?: ListServicesOptions): Promise<ApiResponse<Service[]>> {
    const params: Record<string, string> = {};
    if (options?.agentId) params.agentId = options.agentId;
    if (options?.verusId) params.verusId = options.verusId;
    if (options?.category) params.category = options.category;
    if (options?.status) params.status = options.status;
    if (options?.minPrice !== undefined) params.minPrice = String(options.minPrice);
    if (options?.maxPrice !== undefined) params.maxPrice = String(options.maxPrice);
    if (options?.limit) params.limit = String(options.limit);
    if (options?.offset) params.offset = String(options.offset);
    if (options?.sort) params.sort = options.sort;
    if (options?.order) params.order = options.order;

    return this.http.get<ApiResponse<Service[]>>('/v1/services', params);
  }

  /**
   * Get a single service by ID
   */
  async get(id: string): Promise<ApiResponse<Service>> {
    return this.http.get<ApiResponse<Service>>(`/v1/services/${encodeURIComponent(id)}`);
  }

  /**
   * Get services for an agent
   */
  async getByAgent(verusId: string): Promise<ApiResponse<Service[]>> {
    return this.http.get<ApiResponse<Service[]>>(`/v1/services/agent/${encodeURIComponent(verusId)}`);
  }

  /**
   * Get available categories
   */
  async categories(): Promise<ApiResponse<string[]>> {
    return this.http.get<ApiResponse<string[]>>('/v1/services/categories');
  }

  // ============================================
  // Authenticated endpoints (require login)
  // ============================================

  /**
   * List my services (authenticated)
   */
  async listMine(): Promise<ApiResponse<Service[]>> {
    return this.http.get<ApiResponse<Service[]>>('/v1/me/services');
  }

  /**
   * Create a new service (authenticated)
   */
  async create(input: CreateServiceInput): Promise<ApiResponse<Service>> {
    return this.http.post<ApiResponse<Service>>('/v1/me/services', input);
  }

  /**
   * Update a service (authenticated)
   */
  async update(id: string, input: UpdateServiceInput): Promise<ApiResponse<Service>> {
    return this.http.put<ApiResponse<Service>>(`/v1/me/services/${encodeURIComponent(id)}`, input);
  }

  /**
   * Delete a service (authenticated)
   */
  async delete(id: string): Promise<ApiResponse<{ success: boolean }>> {
    return this.http.delete<ApiResponse<{ success: boolean }>>(`/v1/me/services/${encodeURIComponent(id)}`);
  }
}
