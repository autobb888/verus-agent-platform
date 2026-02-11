/**
 * Registration Request Schema
 * 
 * Validates incoming agent registration requests
 */

import { z } from 'zod';

// Capability schema
const CapabilitySchema = z.object({
  id: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, 'Capability ID must be lowercase alphanumeric with hyphens'),
  name: z.string().min(1).max(128),
  description: z.string().max(500).optional(),
  protocol: z.enum(['MCP', 'REST', 'A2A', 'custom']).optional(),
  endpoint: z.string().url().optional(),
  public: z.boolean().default(true),
});

// Endpoint schema
const EndpointSchema = z.object({
  url: z.string().url(),
  protocol: z.enum(['MCP', 'REST', 'A2A', 'WebSocket']),
  public: z.boolean().default(true),
  description: z.string().max(500).optional(),
});

// Agent data schema (the "data" field in signed payload)
export const AgentDataSchema = z.object({
  name: z.string()
    .min(3, 'Name must be at least 3 characters')
    .max(64, 'Name must be at most 64 characters')
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9.\-_ ]{1,62}[a-zA-Z0-9]$/, 
      'Name must be alphanumeric with dots, hyphens, underscores, or spaces'),
  
  type: z.enum(['autonomous', 'assisted', 'hybrid', 'tool']),
  
  description: z.string()
    .min(10, 'Description must be at least 10 characters')
    .max(1000, 'Description must be at most 1000 characters'),
  
  capabilities: z.array(CapabilitySchema)
    .max(50, 'Maximum 50 capabilities allowed')
    .optional()
    .default([]),
  
  endpoints: z.array(EndpointSchema)
    .max(10, 'Maximum 10 endpoints allowed')
    .optional()
    .default([]),
  
  protocols: z.array(z.enum(['MCP', 'REST', 'A2A', 'WebSocket']))
    .max(10)
    .optional()
    .default([]),
  
  owner: z.string().optional(), // VerusID of human owner (if different from agent identity)
  
  tags: z.array(z.string().max(32))
    .max(20)
    .optional()
    .default([]),
  
  website: z.string().url().optional(),
  
  avatar: z.string().url().optional(),
});

export type AgentData = z.infer<typeof AgentDataSchema>;

// Full registration request schema
export const RegistrationRequestSchema = z.object({
  verusId: z.string()
    .min(2)
    .max(66)
    .refine(
      (val) => val.endsWith('@'),
      'VerusID must end with @'
    ),
  
  timestamp: z.number()
    .int()
    .positive()
    .refine(
      (val) => val > 1700000000 && val < 2000000000,
      'Timestamp must be a valid Unix timestamp in seconds'
    ),
  
  nonce: z.string()
    .uuid('Nonce must be a valid UUID'),
  
  action: z.literal('register'),
  
  data: AgentDataSchema,
  
  signature: z.string()
    .min(20, 'Signature too short')
    .max(500, 'Signature too long'),
});

export type RegistrationRequest = z.infer<typeof RegistrationRequestSchema>;

// Update request schema
export const UpdateRequestSchema = z.object({
  verusId: z.string().min(2).max(66).refine((val) => val.endsWith('@')),
  timestamp: z.number().int().positive(),
  nonce: z.string().uuid(),
  action: z.literal('update'),
  data: AgentDataSchema.partial(), // All fields optional for update
  signature: z.string().min(20).max(500),
});

export type UpdateRequest = z.infer<typeof UpdateRequestSchema>;

// Deactivate request schema
export const DeactivateRequestSchema = z.object({
  verusId: z.string().min(2).max(66).refine((val) => val.endsWith('@')),
  timestamp: z.number().int().positive(),
  nonce: z.string().uuid(),
  action: z.literal('deactivate'),
  data: z.object({
    reason: z.string().max(500).optional(),
  }),
  signature: z.string().min(20).max(500),
});

export type DeactivateRequest = z.infer<typeof DeactivateRequestSchema>;
