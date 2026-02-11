/**
 * Reputation Calculator (Phase 4)
 * 
 * Calculates reputation scores from on-chain indexed reviews.
 * Pure computation — reads from index, never owns data.
 * 
 * Features:
 * - Weighted scoring (recency, reviewer diversity)
 * - Transparency metrics (review rate)
 * - Sybil detection (pattern flagging)
 * - Confidence levels
 */

import { getDatabase } from '../db/index.js';
import { Review } from '../db/schema.js';

export interface ReputationResult {
  score: number | null;              // Weighted average (0-5), null if no reviews
  rawAverage: number | null;         // Simple average
  totalReviews: number;              // All reviews
  verifiedReviews: number;           // Signature-verified reviews
  uniqueReviewers: number;           // Distinct buyer identities
  reviewerDiversity: number;         // uniqueReviewers / totalReviews (0-1)
  confidence: 'none' | 'low' | 'medium' | 'high';
  trending: 'up' | 'down' | 'stable';
  recentReviews: number;             // Last 30 days
  oldestReview: number | null;       // Unix timestamp
  newestReview: number | null;       // Unix timestamp
  lastCalculated: number;            // When this was computed
  
  // Transparency
  transparency: {
    note: string;
    reviewDistribution: { rating: number; count: number }[];
  };
  
  // Sybil signals (if any detected)
  sybilFlags: SybilFlag[];
}

export interface SybilFlag {
  type: 'single-target-reviewer' | 'review-burst' | 'self-review' | 'low-diversity';
  severity: 'low' | 'medium' | 'high';
  description: string;
  affectedReviewIds?: string[];
}

interface ReviewWithWeight extends Review {
  weight: number;
}

const RECENCY_HALF_LIFE_DAYS = 90;  // Reviews lose half weight every 90 days
const BURST_WINDOW_MS = 60 * 60 * 1000;  // 1 hour window for burst detection
const BURST_THRESHOLD = 5;  // 5+ reviews in 1 hour = suspicious

export class ReputationCalculator {
  
  /**
   * Calculate full reputation for an agent
   */
  async calculate(agentVerusId: string): Promise<ReputationResult> {
    const db = getDatabase();
    const now = Date.now();
    
    // Get all reviews for this agent
    const reviews = db.prepare(`
      SELECT * FROM reviews 
      WHERE agent_verus_id = ? 
      ORDER BY review_timestamp DESC
    `).all(agentVerusId) as Review[];
    
    // No reviews case
    if (reviews.length === 0) {
      return {
        score: null,
        rawAverage: null,
        totalReviews: 0,
        verifiedReviews: 0,
        uniqueReviewers: 0,
        reviewerDiversity: 0,
        confidence: 'none',
        trending: 'stable',
        recentReviews: 0,
        oldestReview: null,
        newestReview: null,
        lastCalculated: now,
        transparency: {
          note: 'No reviews yet',
          reviewDistribution: [],
        },
        sybilFlags: [],
      };
    }
    
    // Calculate metrics
    const reviewsWithRatings = reviews.filter(r => r.rating !== null);
    const verifiedReviews = reviews.filter(r => r.verified);
    const uniqueReviewers = new Set(reviews.map(r => r.buyer_verus_id)).size;
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
    const recentReviews = reviews.filter(r => r.review_timestamp * 1000 > thirtyDaysAgo);
    
    // Raw average
    const rawAverage = reviewsWithRatings.length > 0
      ? reviewsWithRatings.reduce((sum, r) => sum + (r.rating || 0), 0) / reviewsWithRatings.length
      : null;
    
    // Weighted score (recency decay)
    const weightedScore = this.calculateWeightedScore(reviewsWithRatings, now);
    
    // Confidence level
    const confidence = this.determineConfidence(
      reviews.length,
      verifiedReviews.length,
      uniqueReviewers,
      reviewsWithRatings.length
    );
    
    // Trend (last 30 days vs previous 30 days)
    const trending = this.calculateTrend(reviewsWithRatings, now);
    
    // Distribution
    const reviewDistribution = this.getDistribution(reviewsWithRatings);
    
    // Sybil detection
    const sybilFlags = this.detectSybilPatterns(reviews, agentVerusId);
    
    // Timestamps
    const timestamps = reviews.map(r => r.review_timestamp);
    const oldestReview = Math.min(...timestamps);
    const newestReview = Math.max(...timestamps);
    
    return {
      score: weightedScore,
      rawAverage,
      totalReviews: reviews.length,
      verifiedReviews: verifiedReviews.length,
      uniqueReviewers,
      reviewerDiversity: reviews.length > 0 ? uniqueReviewers / reviews.length : 0,
      confidence,
      trending,
      recentReviews: recentReviews.length,
      oldestReview,
      newestReview,
      lastCalculated: now,
      transparency: {
        note: this.generateTransparencyNote(reviews.length, verifiedReviews.length, uniqueReviewers),
        reviewDistribution,
      },
      sybilFlags,
    };
  }
  
  /**
   * Calculate weighted score with recency decay
   */
  private calculateWeightedScore(reviews: Review[], now: number): number | null {
    if (reviews.length === 0) return null;
    
    let weightedSum = 0;
    let totalWeight = 0;
    
    for (const review of reviews) {
      if (review.rating === null) continue;
      
      // Recency weight: half-life decay
      const ageMs = now - (review.review_timestamp * 1000);
      const ageDays = ageMs / (24 * 60 * 60 * 1000);
      const recencyWeight = Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
      
      // Verified reviews get slight boost
      const verifiedBoost = review.verified ? 1.1 : 1.0;
      
      const weight = recencyWeight * verifiedBoost;
      weightedSum += review.rating * weight;
      totalWeight += weight;
    }
    
    return totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) / 100 : null;
  }
  
  /**
   * Determine confidence level based on data quality
   */
  private determineConfidence(
    totalReviews: number,
    verifiedReviews: number,
    uniqueReviewers: number,
    reviewsWithRatings: number
  ): 'none' | 'low' | 'medium' | 'high' {
    if (totalReviews === 0) return 'none';
    if (totalReviews < 3) return 'low';
    
    const diversityRatio = uniqueReviewers / totalReviews;
    const verifiedRatio = verifiedReviews / totalReviews;
    
    // High confidence: 10+ reviews, 70%+ diversity, 80%+ verified
    if (totalReviews >= 10 && diversityRatio >= 0.7 && verifiedRatio >= 0.8) {
      return 'high';
    }
    
    // Medium confidence: 5+ reviews, 50%+ diversity
    if (totalReviews >= 5 && diversityRatio >= 0.5) {
      return 'medium';
    }
    
    return 'low';
  }
  
  /**
   * Calculate trend (comparing recent vs previous period)
   */
  private calculateTrend(reviews: Review[], now: number): 'up' | 'down' | 'stable' {
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = now - (60 * 24 * 60 * 60 * 1000);
    
    const recent = reviews.filter(r => 
      r.review_timestamp * 1000 > thirtyDaysAgo && r.rating !== null
    );
    const previous = reviews.filter(r => 
      r.review_timestamp * 1000 > sixtyDaysAgo && 
      r.review_timestamp * 1000 <= thirtyDaysAgo && 
      r.rating !== null
    );
    
    if (recent.length < 2 || previous.length < 2) return 'stable';
    
    const recentAvg = recent.reduce((sum, r) => sum + (r.rating || 0), 0) / recent.length;
    const previousAvg = previous.reduce((sum, r) => sum + (r.rating || 0), 0) / previous.length;
    
    const diff = recentAvg - previousAvg;
    if (diff > 0.3) return 'up';
    if (diff < -0.3) return 'down';
    return 'stable';
  }
  
  /**
   * Get rating distribution
   */
  private getDistribution(reviews: Review[]): { rating: number; count: number }[] {
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    
    for (const review of reviews) {
      if (review.rating !== null && review.rating >= 1 && review.rating <= 5) {
        counts[Math.round(review.rating)]++;
      }
    }
    
    return Object.entries(counts).map(([rating, count]) => ({
      rating: parseInt(rating, 10),
      count,
    }));
  }
  
  /**
   * Generate human-readable transparency note
   */
  private generateTransparencyNote(
    totalReviews: number,
    verifiedReviews: number,
    uniqueReviewers: number
  ): string {
    if (totalReviews === 0) return 'No reviews yet';
    
    const parts: string[] = [];
    parts.push(`${totalReviews} review${totalReviews !== 1 ? 's' : ''}`);
    
    if (verifiedReviews < totalReviews) {
      parts.push(`${verifiedReviews} verified`);
    }
    
    parts.push(`from ${uniqueReviewers} unique reviewer${uniqueReviewers !== 1 ? 's' : ''}`);
    
    return parts.join(', ');
  }
  
  /**
   * Detect Sybil attack patterns
   */
  private detectSybilPatterns(reviews: Review[], agentVerusId: string): SybilFlag[] {
    const flags: SybilFlag[] = [];
    const db = getDatabase();
    
    // 1. Single-target reviewers (reviewer only reviews this agent)
    const reviewerCounts: Record<string, number> = {};
    for (const review of reviews) {
      reviewerCounts[review.buyer_verus_id] = (reviewerCounts[review.buyer_verus_id] || 0) + 1;
    }
    
    for (const [reviewerId, count] of Object.entries(reviewerCounts)) {
      if (count >= 3) {
        // Check if this reviewer reviews other agents
        const otherAgentReviews = db.prepare(`
          SELECT COUNT(*) as count FROM reviews 
          WHERE buyer_verus_id = ? AND agent_verus_id != ?
        `).get(reviewerId, agentVerusId) as { count: number };
        
        if (otherAgentReviews.count === 0) {
          const affectedReviews = reviews
            .filter(r => r.buyer_verus_id === reviewerId)
            .map(r => r.id);
          
          flags.push({
            type: 'single-target-reviewer',
            severity: count >= 5 ? 'high' : 'medium',
            description: `Reviewer ${reviewerId.slice(0, 12)}... left ${count} reviews and reviews no other agents`,
            affectedReviewIds: affectedReviews,
          });
        }
      }
    }
    
    // 2. Review bursts (many reviews in short time)
    const sortedByTime = [...reviews].sort((a, b) => a.review_timestamp - b.review_timestamp);
    for (let i = 0; i < sortedByTime.length; i++) {
      const windowEnd = sortedByTime[i].review_timestamp * 1000 + BURST_WINDOW_MS;
      const burstReviews = sortedByTime.filter(r => 
        r.review_timestamp * 1000 >= sortedByTime[i].review_timestamp * 1000 &&
        r.review_timestamp * 1000 <= windowEnd
      );
      
      if (burstReviews.length >= BURST_THRESHOLD) {
        flags.push({
          type: 'review-burst',
          severity: burstReviews.length >= 10 ? 'high' : 'medium',
          description: `${burstReviews.length} reviews within 1 hour window`,
          affectedReviewIds: burstReviews.map(r => r.id),
        });
        // Skip ahead to avoid duplicate flags
        i += burstReviews.length - 1;
      }
    }
    
    // 3. Low diversity warning
    const diversityRatio = reviews.length > 0 
      ? Object.keys(reviewerCounts).length / reviews.length 
      : 0;
    
    if (reviews.length >= 5 && diversityRatio < 0.3) {
      flags.push({
        type: 'low-diversity',
        severity: 'medium',
        description: `Low reviewer diversity: ${Math.round(diversityRatio * 100)}% unique reviewers`,
      });
    }
    
    // 4. Self-review check (agent reviewing themselves)
    const selfReviews = reviews.filter(r => r.buyer_verus_id === agentVerusId);
    if (selfReviews.length > 0) {
      flags.push({
        type: 'self-review',
        severity: 'high',
        description: `Agent reviewed themselves ${selfReviews.length} time(s)`,
        affectedReviewIds: selfReviews.map(r => r.id),
      });
    }
    
    return flags;
  }
  
  /**
   * Quick score lookup (for listings, doesn't include full analysis)
   */
  async getQuickScore(agentVerusId: string): Promise<{
    score: number | null;
    totalReviews: number;
    confidence: 'none' | 'low' | 'medium' | 'high';
  }> {
    const db = getDatabase();
    
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        AVG(rating) as avg_rating,
        COUNT(DISTINCT buyer_verus_id) as unique_reviewers
      FROM reviews 
      WHERE agent_verus_id = ? AND rating IS NOT NULL
    `).get(agentVerusId) as { total: number; avg_rating: number | null; unique_reviewers: number };
    
    const confidence = this.determineConfidence(
      stats.total,
      stats.total, // Assume verified for quick lookup
      stats.unique_reviewers,
      stats.total
    );
    
    return {
      score: stats.avg_rating ? Math.round(stats.avg_rating * 100) / 100 : null,
      totalReviews: stats.total,
      confidence,
    };
  }
}

// Singleton instance
let calculatorInstance: ReputationCalculator | null = null;

export function getReputationCalculator(): ReputationCalculator {
  if (!calculatorInstance) {
    calculatorInstance = new ReputationCalculator();
  }
  return calculatorInstance;
}
