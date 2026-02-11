// Phase 3+4: Reviews and Reputation API routes
// On-chain reputation - reviews stored in agent's contentmultimap
// Phase 4: Advanced reputation calculator with Sybil detection

import { FastifyInstance } from 'fastify';
import { reviewQueries, reputationQueries, agentQueries } from '../../db/index.js';
import { Review } from '../../db/schema.js';
import { getReputationCalculator } from '../../reputation/calculator.js';

// Transform DB review to API response
function transformReview(review: Review) {
  return {
    id: review.id,
    agentVerusId: review.agent_verus_id,
    buyerVerusId: review.buyer_verus_id,
    jobHash: review.job_hash,
    message: review.message,
    rating: review.rating,
    signature: review.signature,
    timestamp: review.review_timestamp,
    verified: Boolean(review.verified),
    indexedAt: review.indexed_at,
    blockHeight: review.block_height,
  };
}

export async function reviewRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /v1/reviews/agent/:verusId
   * Get all reviews for an agent
   */
  fastify.get('/v1/reviews/agent/:verusId', async (request, reply) => {
    const { verusId } = request.params as { verusId: string };
    const query = request.query as Record<string, string>;
    
    const limit = parseInt(query.limit || '20', 10);
    const offset = parseInt(query.offset || '0', 10);
    const verifiedOnly = query.verified === 'true';

    const agent = agentQueries.getById(verusId);
    if (!agent) {
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: 'Agent not found',
        },
      });
    }

    let reviews = reviewQueries.getByAgent(verusId, limit, offset);
    
    if (verifiedOnly) {
      reviews = reviews.filter(r => r.verified);
    }

    const total = reviewQueries.count(verusId);

    return {
      data: reviews.map(transformReview),
      meta: {
        total,
        limit,
        offset,
        hasMore: offset + reviews.length < total,
      },
      agent: {
        verusId: agent.verus_id,
        name: agent.name,
      },
    };
  });

  /**
   * GET /v1/reviews/buyer/:verusId
   * Get all reviews left by a buyer
   */
  fastify.get('/v1/reviews/buyer/:verusId', async (request) => {
    const { verusId } = request.params as { verusId: string };
    const query = request.query as Record<string, string>;
    
    const limit = parseInt(query.limit || '20', 10);
    const offset = parseInt(query.offset || '0', 10);

    const reviews = reviewQueries.getByBuyer(verusId, limit, offset);

    return {
      data: reviews.map(transformReview),
      buyer: verusId,
    };
  });

  /**
   * GET /v1/reviews/job/:jobHash
   * Get a review by job hash
   */
  fastify.get('/v1/reviews/job/:jobHash', async (request, reply) => {
    const { jobHash } = request.params as { jobHash: string };
    const review = reviewQueries.getByJobHash(jobHash);

    if (!review) {
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: 'Review not found',
        },
      });
    }

    return { data: transformReview(review) };
  });

  /**
   * GET /v1/reputation/:verusId
   * Get aggregated reputation for an agent (Phase 4: full calculator)
   */
  fastify.get('/v1/reputation/:verusId', async (request, reply) => {
    const { verusId } = request.params as { verusId: string };
    const query = request.query as Record<string, string>;
    const quick = query.quick === 'true';

    const agent = agentQueries.getById(verusId);
    if (!agent) {
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: 'Agent not found',
        },
      });
    }

    const calculator = getReputationCalculator();
    
    // Quick mode for listings (less computation)
    if (quick) {
      const quickScore = await calculator.getQuickScore(verusId);
      return {
        data: {
          verusId: agent.verus_id,
          name: agent.name,
          score: quickScore.score,
          totalReviews: quickScore.totalReviews,
          confidence: quickScore.confidence,
        },
      };
    }
    
    // Full calculation
    const reputation = await calculator.calculate(verusId);

    return {
      data: {
        verusId: agent.verus_id,
        name: agent.name,
        score: reputation.score,
        rawAverage: reputation.rawAverage,
        totalReviews: reputation.totalReviews,
        verifiedReviews: reputation.verifiedReviews,
        uniqueReviewers: reputation.uniqueReviewers,
        reviewerDiversity: Math.round(reputation.reviewerDiversity * 100) / 100,
        confidence: reputation.confidence,
        trending: reputation.trending,
        recentReviews: reputation.recentReviews,
        transparency: reputation.transparency,
        sybilFlags: reputation.sybilFlags.length > 0 ? reputation.sybilFlags : undefined,
        timestamps: {
          oldest: reputation.oldestReview,
          newest: reputation.newestReview,
          calculated: reputation.lastCalculated,
        },
      },
    };
  });

  /**
   * GET /v1/reputation/top
   * Get top-rated agents by reputation
   */
  fastify.get('/v1/reputation/top', async (request) => {
    const query = request.query as Record<string, string>;
    const limit = parseInt(query.limit || '10', 10);
    
    const topAgents = reputationQueries.getTopAgents(limit);

    return {
      data: topAgents.map((a) => ({
        verusId: a.verus_id,
        name: a.name,
        totalReviews: a.total_reviews,
        verifiedReviews: a.verified_reviews,
        averageRating: a.average_rating,
        totalJobsCompleted: a.total_jobs_completed,
      })),
    };
  });
}
