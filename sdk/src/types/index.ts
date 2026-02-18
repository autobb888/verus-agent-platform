/**
 * Verus Agent Platform SDK Types
 */

// ============================================
// Agent Types
// ============================================

export interface Agent {
  id: string;
  verusId: string;
  name: string;
  type: 'autonomous' | 'assisted' | 'hybrid' | 'tool';
  description: string | null;
  owner: string;
  status: 'active' | 'inactive' | 'deprecated';
  createdAt: string;
  updatedAt: string;
  blockHeight: number;
}

export interface AgentCapability {
  id: string;
  capabilityId: string;
  name: string;
  description: string | null;
  protocol: string;
  endpoint: string | null;
  public: boolean;
  pricing?: {
    model: string;
    amount: number;
    currency: string;
  };
}

export interface AgentEndpoint {
  id: string;
  url: string;
  protocol: string;
  public: boolean;
  verified: boolean;
  verifiedAt: string | null;
}

// ============================================
// Service Types
// ============================================

export interface Service {
  id: string;
  agentId: string;
  verusId: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  category: string | null;
  turnaround: string | null;
  status: 'active' | 'inactive' | 'deprecated';
  createdAt: string;
  updatedAt: string;
}

export interface CreateServiceInput {
  name: string;
  description?: string;
  price: number;
  currency?: string;
  category?: string;
  turnaround?: string;
  status?: 'active' | 'inactive';
}

export interface UpdateServiceInput {
  name?: string;
  description?: string;
  price?: number;
  currency?: string;
  category?: string;
  turnaround?: string;
  status?: 'active' | 'inactive' | 'deprecated';
}

// ============================================
// Review Types
// ============================================

export interface Review {
  id: string;
  agentVerusId: string;
  buyerVerusId: string;
  jobHash: string;
  message: string | null;
  rating: number | null;
  timestamp: number;
  verified: boolean;
  blockHeight: number;
}

export interface SubmitReviewInput {
  agentVerusId: string;
  jobHash: string;
  message?: string;
  rating?: number;
}

export interface ReviewMessage {
  message: string;
  timestamp: number;
}

// ============================================
// Reputation Types
// ============================================

export interface Reputation {
  verusId: string;
  name: string;
  score: number | null;
  rawAverage: number | null;
  totalReviews: number;
  verifiedReviews: number;
  uniqueReviewers: number;
  reviewerDiversity: number;
  confidence: 'none' | 'low' | 'medium' | 'high';
  trending: 'up' | 'down' | 'stable';
  recentReviews: number;
  transparency: {
    note: string;
    reviewDistribution: { rating: number; count: number }[];
  };
  sybilFlags?: SybilFlag[];
}

export interface QuickReputation {
  verusId: string;
  name: string;
  score: number | null;
  totalReviews: number;
  confidence: 'none' | 'low' | 'medium' | 'high';
}

export interface SybilFlag {
  type: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
}

// ============================================
// Inbox Types
// ============================================

export interface InboxItem {
  id: string;
  type: 'review' | 'message' | 'service_request';
  senderVerusId: string;
  jobHash: string | null;
  rating: number | null;
  message: string | null;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  createdAt: string;
  expiresAt: string;
  vdxfData: Record<string, unknown> | null;
  updateCommand?: string;
}

// ============================================
// Auth Types
// ============================================

export interface AuthChallenge {
  challenge: string;
  expiresAt: number;
}

export interface Session {
  verusId: string;
  expiresAt: number;
}

// ============================================
// API Response Types
// ============================================

export interface ApiResponse<T> {
  data: T;
  meta?: {
    total?: number;
    limit?: number;
    offset?: number;
    hasMore?: boolean;
  };
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// ============================================
// Client Config
// ============================================

export interface ClientConfig {
  baseUrl: string;
  timeout?: number;
  headers?: Record<string, string>;
}

export interface AuthenticatedClientConfig extends ClientConfig {
  sessionCookie?: string;
}

// ============================================
// Signer Interface
// ============================================

export interface Signer {
  /**
   * Get the VerusID this signer represents
   */
  getVerusId(): string;
  
  /**
   * Sign a message with the VerusID
   */
  sign(message: string): Promise<string>;
}

// ============================================
// Onboard Types
// ============================================

export interface OnboardChallenge {
  challenge: string;
  token: string;
}

export interface CreateIdentityResponse {
  onboardId: string;
  status: 'pending' | 'registered' | 'failed';
  identity?: string;
  iAddress?: string;
  txid?: string;
  error?: string;
}

export interface OnboardStatus {
  onboardId: string;
  status: 'pending' | 'registered' | 'failed';
  identity?: string;
  iAddress?: string;
  txid?: string;
  error?: string;
  blockHeight?: number;
  confirmedAt?: string;
}
