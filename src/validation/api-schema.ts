import { z } from 'zod';

// Query parameters for listing agents
export const ListAgentsQuery = z.object({
  status: z.enum(['active', 'inactive', 'deprecated']).optional(),
  type: z.enum(['autonomous', 'assisted', 'hybrid', 'tool']).optional(),
  capability: z.string().max(100).optional(),
  owner: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  sort: z.enum(['created_at', 'updated_at', 'name', 'block_height']).default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export type ListAgentsQueryValue = z.infer<typeof ListAgentsQuery>;

// Path parameters for agent routes
export const AgentIdParam = z.object({
  id: z.string().min(1).max(255),
});

// Generic pagination response meta
export interface PaginationMeta {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

// API response wrapper
export interface ApiResponse<T> {
  data: T;
  meta?: PaginationMeta;
}

// Error response
export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

// Validate and sanitize query parameters
export function validateQueryParams<T>(
  schema: z.ZodSchema<T>,
  params: unknown
): { success: true; data: T } | { success: false; error: string } {
  try {
    const result = schema.safeParse(params);
    if (result.success) {
      return { success: true, data: result.data };
    }
    const issues = result.error.issues;
    return {
      success: false,
      error: issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
    };
  } catch (err) {
    return { success: false, error: 'Invalid query parameters' };
  }
}
