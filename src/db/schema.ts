// Database schema types matching PostgreSQL spec (SQLite compatible)

export interface Agent {
  id: string;
  verus_id: string;
  name: string;
  type: 'autonomous' | 'assisted' | 'hybrid' | 'tool';
  description: string | null;
  owner: string;
  status: 'active' | 'inactive' | 'deprecated';
  revoked: number;  // SQLite INTEGER: 0 = false, 1 = true
  privacy_tier?: 'standard' | 'private' | 'sovereign';
  privacy_tier_verified?: number;  // 0 = self-declared, 1 = platform-verified
  created_at: string;
  updated_at: string;
  indexed_at: string;
  block_height: number;
  block_hash: string;
  confirmation_count: number;
  protocols: string | null;  // JSON array: ["MCP", "A2A", "REST"]
  startup_recouped: number;  // 0 = not recouped, 1 = recouped
  communication_policy: string | null;  // 'safechat_only' | 'safechat_preferred' | 'external'
  external_channels: string | null;  // JSON array of external channel URLs
}

export interface AgentCapability {
  id: string;
  agent_id: string;
  capability_id: string;
  name: string;
  description: string | null;
  protocol: string;
  endpoint: string | null;
  public: number;  // SQLite INTEGER: 0 = false, 1 = true
  pricing_model: string | null;
  pricing_amount: number | null;
  pricing_currency: string | null;
}

export interface AgentEndpoint {
  id: string;
  agent_id: string;
  url: string;
  protocol: string;
  public: number;  // SQLite INTEGER: 0 = false, 1 = true
}

export interface SyncState {
  id: number;
  last_block_height: number;
  last_block_hash: string;
  updated_at: string;
}

// Phase 3: Service listings
export interface Service {
  id: string;
  agent_id: string;          // FK to agents
  verus_id: string;          // Agent's VerusID
  name: string;
  description: string | null;
  price: number;
  currency: string;          // VRSC, VRSCTEST, etc.
  category: string | null;
  turnaround: string | null; // "24 hours", "1 week", etc.
  status: 'active' | 'inactive' | 'deprecated';
  session_params: string | null;  // JSON: SessionParams
  created_at: string;
  updated_at: string;
  indexed_at: string;
  block_height: number;
}

// Phase 3: On-chain reviews (stored in agent's contentmultimap)
export interface Review {
  id: string;
  agent_id: string;          // FK to agents (the agent being reviewed)
  agent_verus_id: string;    // Agent's VerusID
  buyer_verus_id: string;    // Buyer's VerusID who left the review
  job_hash: string;          // Unique hash identifying the job
  message: string | null;    // Review text
  rating: number | null;     // Optional numeric rating (1-5)
  signature: string;         // Buyer's signature on the review
  review_timestamp: number;  // Unix timestamp from the review
  verified: boolean;         // Signature verified by platform
  created_at: string;
  indexed_at: string;
  block_height: number;
}

// Phase 3: Agent reputation (aggregated from reviews)
export interface AgentReputation {
  agent_id: string;          // FK to agents
  total_reviews: number;
  verified_reviews: number;
  average_rating: number | null;
  total_jobs_completed: number;
  updated_at: string;
}

// Phase 3: Inbox for pending items
// Platform facilitates but doesn't own - items here are waiting for
// the agent to add them to their on-chain VerusID
export interface InboxItem {
  id: string;
  recipient_verus_id: string;  // Agent who should receive this
  type: 'review' | 'message' | 'service_request' | 'job_request' | 'job_accepted' | 'job_delivered' | 'job_completed';
  sender_verus_id: string;     // Who sent it
  
  // For reviews
  job_hash: string | null;
  rating: number | null;
  message: string | null;
  signature: string | null;    // Sender's signature
  
  // Metadata
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  created_at: string;
  expires_at: string;
  processed_at: string | null;
  
  // Formatted VDXF data for agent to add to their identity
  vdxf_data: string | null;
}

// Phase 4: A2A Jobs
export interface Job {
  id: string;
  job_hash: string;            // Unique job identifier (hash of key fields)
  
  // Parties
  buyer_verus_id: string;      // Agent requesting the job
  seller_verus_id: string;     // Agent performing the job
  service_id: string | null;   // Optional reference to service listing
  
  // Terms
  description: string;
  amount: number;
  currency: string;
  deadline: string | null;     // ISO timestamp
  
  // Payment
  payment_terms: 'prepay' | 'postpay' | 'split';
  payment_address: string | null;  // Where to send payment
  payment_txid: string | null;     // Proof of agent payment
  payment_verified: number;        // 0 = unverified, 1 = verified
  platform_fee_txid: string | null;   // Proof of 5% fee payment to SafeChat ID
  platform_fee_verified: number;      // 0 = unverified, 1 = verified
  
  // SafeChat
  safechat_enabled: number;        // 0 = disabled, 1 = enabled
  
  // Signatures (proof of agreement)
  request_signature: string;   // Buyer's signature on job request
  acceptance_signature: string | null;  // Seller's signature on acceptance
  delivery_signature: string | null;    // Seller's signature on delivery
  completion_signature: string | null;  // Buyer's signature on completion
  
  // State machine
  status: 'requested' | 'accepted' | 'in_progress' | 'delivered' | 'completed' | 'disputed' | 'cancelled';
  
  // Delivery
  delivery_hash: string | null;   // Hash/URL of delivered work
  delivery_message: string | null;
  
  // Timestamps
  requested_at: string;
  accepted_at: string | null;
  delivered_at: string | null;
  completed_at: string | null;
  
  created_at: string;
  updated_at: string;
}

// Phase 4b: Job Messages
export interface JobMessage {
  id: string;
  job_id: string;
  sender_verus_id: string;
  content: string;
  signed: number;              // 0 = unsigned, 1 = signed
  signature: string | null;
  safety_score: number | null;
  created_at: string;
}

export interface JobReadReceipt {
  job_id: string;
  verus_id: string;
  last_read_at: string;
}

// Phase 6b: Job File Attachments
export interface JobFile {
  id: string;
  job_id: string;
  message_id: string | null;
  uploader_verus_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  checksum: string;           // SHA-256
  created_at: string;
}

export interface ChatToken {
  id: string;
  verus_id: string;
  created_at: string;
  expires_at: string;
  used: number;
}

// Phase 7: Deletion Attestation (SDK-signed)
export interface Attestation {
  id: string;
  agent_id: string;
  job_id: string | null;
  container_id: string;
  created_at: string;
  destroyed_at: string;
  data_volumes: string | null;  // JSON array stored as text
  deletion_method: string;
  attested_by: string;
  signature: string;
  submitted_at: string;
}
