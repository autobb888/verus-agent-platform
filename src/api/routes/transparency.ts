/**
 * Agent Transparency Scores API (Phase 6c)
 * 
 * Provides verified trust signals and declared data handling policies.
 * Verified = platform-confirmed from on-chain/DB data.
 * Declared = agent-stated, unverified.
 * 
 * Endpoints:
 * - GET /v1/agents/:verusId/transparency  — Full transparency profile
 * - GET /v1/agents/:verusId/trust-level   — Quick trust level check
 */

import { FastifyInstance } from 'fastify';
import { agentQueries, jobQueries, reviewQueries, reputationQueries, serviceQueries } from '../../db/index.js';
import { getDatabase } from '../../db/index.js';
import { getRpcClient } from '../../indexer/rpc-client.js';

// Trust level thresholds
// Shield note: Consider job-value weighting in future (50×$1 ≠ 50×$500)
interface TrustThresholds {
  minJobs: number;
  maxDisputeRate: number;
  minRating?: number;
  minDaysActive: number;
}

const TRUST_LEVELS: Record<string, TrustThresholds> = {
  trusted:       { minJobs: 50, maxDisputeRate: 0.02, minRating: 4.0, minDaysActive: 90 },
  established:   { minJobs: 20, maxDisputeRate: 0.03, minDaysActive: 60 },
  establishing:  { minJobs: 5,  maxDisputeRate: 0.05, minDaysActive: 0 },
  new:           { minJobs: 0,  maxDisputeRate: 1.0,  minDaysActive: 0 },
};

interface TransparencyProfile {
  verified: {
    jobsCompleted: number;
    jobsDisputed: number;
    disputeRate: number;
    avgResponseTimeSeconds: number | null;
    activeSince: string | null;        // ISO date
    identityAgeDays: number | null;
    reviewCount: number;
    verifiedReviewCount: number;
    averageRating: number | null;
    servicesListed: number;
  };
  declared: {
    dataRetention: string | null;
    thirdPartySharing: boolean | null;
    trainingOnData: boolean | null;
    aiModel: string | null;
    hosting: string | null;
    lastDeclaredAt: string | null;
  };
  computed: {
    trustLevel: 'new' | 'establishing' | 'established' | 'trusted';
    trustScore: number;          // 0-100
    declarationStale: boolean;   // Shield: stale declarations should visually decay
  };
}

function computeTrustLevel(
  jobsCompleted: number,
  disputeRate: number,
  avgRating: number | null,
  daysActive: number
): 'new' | 'establishing' | 'established' | 'trusted' {
  const t = TRUST_LEVELS;
  
  if (
    jobsCompleted >= t.trusted.minJobs &&
    disputeRate <= t.trusted.maxDisputeRate &&
    (avgRating === null || avgRating >= (t.trusted.minRating || 0)) &&
    daysActive >= t.trusted.minDaysActive
  ) return 'trusted';

  if (
    jobsCompleted >= t.established.minJobs &&
    disputeRate <= t.established.maxDisputeRate &&
    daysActive >= t.established.minDaysActive
  ) return 'established';

  if (
    jobsCompleted >= t.establishing.minJobs &&
    disputeRate <= t.establishing.maxDisputeRate
  ) return 'establishing';

  return 'new';
}

function computeTrustScore(profile: TransparencyProfile['verified']): number {
  let score = 0;

  // Jobs completed (max 30 pts)
  score += Math.min(profile.jobsCompleted / 50 * 30, 30);

  // Low dispute rate (max 20 pts)
  if (profile.jobsCompleted > 0) {
    score += Math.max(0, (1 - profile.disputeRate * 10)) * 20;
  }

  // Good ratings (max 25 pts)
  if (profile.averageRating !== null) {
    score += (profile.averageRating / 5) * 25;
  }

  // Identity age (max 15 pts)
  if (profile.identityAgeDays !== null) {
    score += Math.min(profile.identityAgeDays / 180 * 15, 15);
  }

  // Has reviews (max 10 pts)
  score += Math.min(profile.verifiedReviewCount / 10 * 10, 10);

  return Math.round(Math.min(score, 100));
}

// P2-OUT-5: Cache RPC identity lookups (5 min TTL) to prevent DoS via repeated calls
const identityCache = new Map<string, { iAddress: string; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function resolveIdentityCached(verusId: string): Promise<string | null> {
  const cached = identityCache.get(verusId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.iAddress;
  }

  const rpc = getRpcClient();
  try {
    const identity = await rpc.getIdentity(verusId);
    const iAddress = identity.identity.identityaddress;
    identityCache.set(verusId, { iAddress, expiresAt: Date.now() + CACHE_TTL_MS });
    return iAddress;
  } catch {
    return null;
  }
}

// Cleanup stale cache entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of identityCache) {
    if (val.expiresAt < now) identityCache.delete(key);
  }
}, 10 * 60 * 1000);

export async function transparencyRoutes(fastify: FastifyInstance): Promise<void> {

  /**
   * GET /v1/agents/:verusId/transparency
   * Full transparency profile for an agent
   */
  fastify.get('/v1/agents/:verusId/transparency', async (request, reply) => {
    const { verusId } = request.params as { verusId: string };

    const iAddress = await resolveIdentityCached(verusId);
    if (!iAddress) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Identity not found' },
      });
    }

    const agent = agentQueries.getById(iAddress);
    if (!agent) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Agent not registered on platform' },
      });
    }

    const db = getDatabase();

    // Verified stats from platform data
    const jobStats = db.prepare(`
      SELECT 
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        COUNT(CASE WHEN status = 'disputed' THEN 1 END) as disputed,
        COUNT(*) as total
      FROM jobs 
      WHERE seller_verus_id = ?
    `).get(iAddress) as { completed: number; disputed: number; total: number };

    // Average response time (time between job creation and acceptance)
    const avgResponse = db.prepare(`
      SELECT AVG(
        CAST((julianday(accepted_at) - julianday(requested_at)) * 86400 AS INTEGER)
      ) as avg_seconds
      FROM jobs 
      WHERE seller_verus_id = ? AND accepted_at IS NOT NULL
    `).get(iAddress) as { avg_seconds: number | null };

    const reputation = reputationQueries.get(agent.id);
    const serviceCount = serviceQueries.getByAgentId(agent.id).length;

    // Identity age
    const createdAt = new Date(agent.created_at);
    const daysActive = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));

    const disputeRate = jobStats.total > 0 ? jobStats.disputed / jobStats.total : 0;

    const verified = {
      jobsCompleted: jobStats.completed,
      jobsDisputed: jobStats.disputed,
      disputeRate: Math.round(disputeRate * 1000) / 1000,
      avgResponseTimeSeconds: avgResponse.avg_seconds ? Math.round(avgResponse.avg_seconds) : null,
      activeSince: agent.created_at,
      identityAgeDays: daysActive,
      reviewCount: reputation?.total_reviews || 0,
      verifiedReviewCount: reputation?.verified_reviews || 0,
      averageRating: reputation?.average_rating ? Math.round(reputation.average_rating * 10) / 10 : null,
      servicesListed: serviceCount,
    };

    // Declared data (from agent's VDXF contentmultimap — future)
    // For now, return nulls. Will be populated when agents update their identity
    // with vrsc::agent.transparency.v1 data
    const declared = {
      dataRetention: null,
      thirdPartySharing: null,
      trainingOnData: null,
      aiModel: null,
      hosting: null,
      lastDeclaredAt: null,
    };

    const trustLevel = computeTrustLevel(
      jobStats.completed,
      disputeRate,
      reputation?.average_rating || null,
      daysActive
    );

    // Shield: stale declarations should visually decay
    const declarationStale = declared.lastDeclaredAt
      ? (Date.now() - new Date(declared.lastDeclaredAt).getTime()) > 90 * 24 * 60 * 60 * 1000 // >90 days
      : true; // No declaration = stale

    const profile: TransparencyProfile = {
      verified,
      declared,
      computed: {
        trustLevel,
        trustScore: computeTrustScore(verified),
        declarationStale,
      },
    };

    return { data: profile };
  });

  /**
   * GET /v1/agents/:verusId/trust-level
   * Quick trust level check (lightweight)
   */
  fastify.get('/v1/agents/:verusId/trust-level', async (request, reply) => {
    const { verusId } = request.params as { verusId: string };

    const iAddress = await resolveIdentityCached(verusId);
    if (!iAddress) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Identity not found' },
      });
    }

    const agent = agentQueries.getById(iAddress);
    if (!agent) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Agent not registered' },
      });
    }

    const db = getDatabase();
    const jobStats = db.prepare(`
      SELECT 
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        COUNT(CASE WHEN status = 'disputed' THEN 1 END) as disputed,
        COUNT(*) as total
      FROM jobs WHERE seller_verus_id = ?
    `).get(iAddress) as { completed: number; disputed: number; total: number };

    const reputation = reputationQueries.get(agent.id);
    const daysActive = Math.floor((Date.now() - new Date(agent.created_at).getTime()) / (1000 * 60 * 60 * 24));
    const disputeRate = jobStats.total > 0 ? jobStats.disputed / jobStats.total : 0;

    const trustLevel = computeTrustLevel(
      jobStats.completed,
      disputeRate,
      reputation?.average_rating || null,
      daysActive
    );

    return {
      data: {
        verusId,
        trustLevel,
        jobsCompleted: jobStats.completed,
        disputeRate: Math.round(disputeRate * 1000) / 1000,
        averageRating: reputation?.average_rating ? Math.round(reputation.average_rating * 10) / 10 : null,
      },
    };
  });
}
