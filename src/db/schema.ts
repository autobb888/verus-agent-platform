// Database schema types matching PostgreSQL spec (SQLite compatible)

export interface Agent {
  id: string;
  verus_id: string;
  name: string;
  type: 'autonomous' | 'assisted' | 'tool';
  description: string | null;
  owner: string;
  status: 'active' | 'inactive' | 'deprecated';
  revoked: boolean;
  created_at: string;
  updated_at: string;
  indexed_at: string;
  block_height: number;
  block_hash: string;
  confirmation_count: number;
}

export interface AgentCapability {
  id: string;
  agent_id: string;
  capability_id: string;
  name: string;
  description: string | null;
  protocol: string;
  endpoint: string | null;
  public: boolean;
  pricing_model: string | null;
  pricing_amount: number | null;
  pricing_currency: string | null;
}

export interface AgentEndpoint {
  id: string;
  agent_id: string;
  url: string;
  protocol: string;
  public: boolean;
}

export interface SyncState {
  id: number;
  last_block_height: number;
  last_block_hash: string;
  updated_at: string;
}
