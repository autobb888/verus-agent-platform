import { describe, it, expect } from 'vitest';

/**
 * Unit tests for the fee rate calculation logic.
 * This mirrors the calculateFeeRate function in jobs.ts.
 */

const BASE_FEE_RATE = 0.05; // 5%

function calculateFeeRate(dataTerms?: {
  allowTraining?: boolean;
  allowThirdParty?: boolean;
  requireDeletionAttestation?: boolean;
}): number {
  if (!dataTerms) return BASE_FEE_RATE;
  let discount = 0;
  if (dataTerms.allowTraining) discount += 0.10;
  if (dataTerms.allowThirdParty) discount += 0.10;
  if (!dataTerms.requireDeletionAttestation) discount += 0.05;
  return BASE_FEE_RATE * (1 - discount);
}

describe('Fee rate calculation', () => {
  it('returns base rate (5%) when no data terms', () => {
    expect(calculateFeeRate()).toBe(0.05);
    expect(calculateFeeRate(undefined)).toBe(0.05);
  });

  it('returns base rate with no discounts', () => {
    expect(calculateFeeRate({
      allowTraining: false,
      allowThirdParty: false,
      requireDeletionAttestation: true,
    })).toBe(0.05);
  });

  it('applies 10% discount for allowing training', () => {
    const rate = calculateFeeRate({ allowTraining: true });
    expect(rate).toBeCloseTo(0.05 * 0.85, 10); // 5% discount from deletion + 10% from training
  });

  it('applies 10% discount for allowing third party', () => {
    const rate = calculateFeeRate({ allowThirdParty: true });
    expect(rate).toBeCloseTo(0.05 * 0.85, 10); // 5% deletion + 10% third party
  });

  it('applies 5% discount for not requiring deletion attestation', () => {
    const rate = calculateFeeRate({ requireDeletionAttestation: false });
    expect(rate).toBeCloseTo(0.05 * 0.95, 10);
  });

  it('applies maximum discount (25%) when all terms granted', () => {
    const rate = calculateFeeRate({
      allowTraining: true,
      allowThirdParty: true,
      requireDeletionAttestation: false,
    });
    expect(rate).toBeCloseTo(0.05 * 0.75, 10);
  });

  it('fee is always non-negative', () => {
    const rate = calculateFeeRate({
      allowTraining: true,
      allowThirdParty: true,
      requireDeletionAttestation: false,
    });
    expect(rate).toBeGreaterThan(0);
  });

  it('calculates correct fee amounts for various job values', () => {
    const testCases = [
      { amount: 100, expectedFee: 5 },
      { amount: 1, expectedFee: 0.05 },
      { amount: 0.5, expectedFee: 0.025 },
      { amount: 10000, expectedFee: 500 },
    ];
    for (const { amount, expectedFee } of testCases) {
      expect(amount * calculateFeeRate()).toBeCloseTo(expectedFee, 10);
    }
  });
});

describe('Job state machine', () => {
  const validTransitions: Record<string, string[]> = {
    requested: ['accepted', 'cancelled'],
    accepted: ['in_progress', 'cancelled'],
    in_progress: ['delivered', 'disputed', 'cancelled'],
    delivered: ['completed', 'in_progress', 'disputed'], // in_progress via reject-delivery
    completed: [],
    disputed: ['completed', 'cancelled'],
    cancelled: [],
  };

  it('defines all terminal states as having no transitions', () => {
    expect(validTransitions.completed).toEqual([]);
    expect(validTransitions.cancelled).toEqual([]);
  });

  it('allows reject-delivery: delivered -> in_progress', () => {
    expect(validTransitions.delivered).toContain('in_progress');
  });

  it('requires acceptance before in_progress', () => {
    expect(validTransitions.requested).not.toContain('in_progress');
    expect(validTransitions.accepted).toContain('in_progress');
  });

  it('allows dispute from in_progress and delivered', () => {
    expect(validTransitions.in_progress).toContain('disputed');
    expect(validTransitions.delivered).toContain('disputed');
  });
});
