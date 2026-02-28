import { z } from 'zod';
import { isReservedName } from '../utils/reserved-names.js';
import { hasHomoglyphs } from '../utils/homoglyph.js';
import { config } from '../config/index.js';

// VDXF namespace prefix (configurable via VDXF_NAMESPACE_ROOT env var)
export function getVdxfPrefix(): string {
  return `${config.vdxf.namespaceRoot}::agent.v1`;
}

// Legacy constant for backwards compatibility
export const VDXF_PREFIX = getVdxfPrefix();

// Agent types
export const AgentType = z.enum(['autonomous', 'assisted', 'hybrid', 'tool']);
export type AgentTypeValue = z.infer<typeof AgentType>;

// Agent status
export const AgentStatus = z.enum(['active', 'inactive', 'deprecated']);
export type AgentStatusValue = z.infer<typeof AgentStatus>;

// Protocols
export const Protocol = z.enum(['MCP', 'A2A', 'REST', 'WebSocket', 'gRPC']);

// Pricing model
export const PricingModel = z.enum(['free', 'per-call', 'subscription', 'usage-based']);

// Capability pricing
export const CapabilityPricing = z.object({
  model: PricingModel,
  amount: z.string().regex(/^\d+\.?\d*$/).optional(),
  currency: z.string().max(20).optional(),
}).optional();

// Capability object
export const Capability = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  protocol: Protocol,
  endpoint: z.string().url().optional(),
  public: z.boolean().default(true),
  pricing: CapabilityPricing,
  rateLimit: z.string().max(50).optional(),
});
export type CapabilityValue = z.infer<typeof Capability>;

// Endpoint object
export const Endpoint = z.object({
  url: z.string().url(),
  protocol: Protocol,
  public: z.boolean().default(true),
});
export type EndpointValue = z.infer<typeof Endpoint>;

// Name validation with security checks
export const AgentName = z
  .string()
  .min(3, 'Name must be at least 3 characters')
  .max(64, 'Name must be at most 64 characters')
  .regex(/^[a-zA-Z0-9._-]+$/, 'Name can only contain alphanumeric characters, dots, underscores, and hyphens')
  .refine((name) => !isReservedName(name), {
    message: 'This name is reserved and cannot be used',
  })
  .refine((name) => !hasHomoglyphs(name), {
    message: 'Name contains characters that could be used for impersonation',
  });

// Session parameters (agent-defined per-service session limits)
export const SessionParams = z.object({
  duration:         z.number().int().min(60).max(86400).optional(),      // 1 min to 24 hours (seconds)
  tokenLimit:       z.number().int().min(100).max(1000000).optional(),
  imageLimit:       z.number().int().min(0).max(1000).optional(),
  messageLimit:     z.number().int().min(1).max(10000).optional(),
  maxFileSize:      z.number().int().min(0).max(104857600).optional(),   // up to 100MB
  allowedFileTypes: z.string().max(500).optional(),                      // comma-separated MIME types
}).optional();
export type SessionParamsValue = z.infer<typeof SessionParams>;

// Full agent identity schema
export const AgentIdentity = z.object({
  version: z.literal('1').default('1'),
  type: AgentType,
  name: AgentName,
  description: z.string().max(1000).optional(),
  capabilities: z.array(Capability).max(50).default([]),
  endpoints: z.array(Endpoint).max(10).default([]),
  protocols: z.array(Protocol).default([]),
  owner: z.string().min(1),
  signature: z.string().optional(),
  status: AgentStatus.default('active'),
  revoked: z.boolean().default(false),
  contentHash: z.string().optional(),
  created: z.string().datetime().optional(),
  updated: z.string().datetime().optional(),
});
export type AgentIdentityValue = z.infer<typeof AgentIdentity>;

// Parse agent data from chain with defensive handling
export function parseAgentData(rawData: unknown): { success: true; data: AgentIdentityValue } | { success: false; error: string } {
  try {
    // Defensive checks for memory exhaustion
    const jsonStr = typeof rawData === 'string' ? rawData : JSON.stringify(rawData);
    
    // Max size check (10KB)
    if (jsonStr.length > 10240) {
      return { success: false, error: 'Agent data exceeds maximum size (10KB)' };
    }

    // Parse with depth limit (handled by JSON.parse naturally for reasonable depths)
    const parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
    
    // Validate against schema
    const result = AgentIdentity.safeParse(parsed);
    
    if (result.success) {
      return { success: true, data: result.data };
    } else {
      return { success: false, error: result.error.issues.map((e) => e.message).join(', ') };
    }
  } catch (err) {
    return { success: false, error: `Parse error: ${err instanceof Error ? err.message : 'Unknown error'}` };
  }
}

// VDXF key names for reference (dynamically generated)
export function getVdxfKeys() {
  const prefix = getVdxfPrefix();
  return {
    version: `${prefix}.version`,
    type: `${prefix}.type`,
    name: `${prefix}.name`,
    description: `${prefix}.description`,
    capabilities: `${prefix}.capabilities`,
    endpoints: `${prefix}.endpoints`,
    protocols: `${prefix}.protocols`,
    owner: `${prefix}.owner`,
    signature: `${prefix}.signature`,
    status: `${prefix}.status`,
    revoked: `${prefix}.revoked`,
    contentHash: `${prefix}.contentHash`,
    created: `${prefix}.created`,
    updated: `${prefix}.updated`,
  } as const;
}

// Legacy export for backwards compatibility
export const VDXF_KEYS = getVdxfKeys();
