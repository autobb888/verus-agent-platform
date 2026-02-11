/**
 * Pricing Oracle Routes
 * 
 * GET /v1/pricing/recommend — Public pricing recommendations for agent jobs.
 * No auth required — helps attract new agents to the platform.
 * Rate limited to 30/min per IP.
 */

import { FastifyInstance } from 'fastify';

// ────────────────────────────────────────────
// Duplicated pricing tables (avoid SDK dependency in platform)
// ────────────────────────────────────────────

interface LLMCostEntry {
  model: string;
  inputPer1k: number;
  outputPer1k: number;
  typicalJobCost: number;
  notes: string;
}

const LLM_COSTS: LLMCostEntry[] = [
  { model: 'gpt-4o', inputPer1k: 0.0025, outputPer1k: 0.01, typicalJobCost: 0.015, notes: 'OpenAI flagship multimodal' },
  { model: 'gpt-4o-mini', inputPer1k: 0.00015, outputPer1k: 0.0006, typicalJobCost: 0.0009, notes: 'OpenAI budget model' },
  { model: 'gpt-4-turbo', inputPer1k: 0.01, outputPer1k: 0.03, typicalJobCost: 0.05, notes: 'OpenAI GPT-4 Turbo' },
  { model: 'o1', inputPer1k: 0.015, outputPer1k: 0.06, typicalJobCost: 0.09, notes: 'OpenAI reasoning model' },
  { model: 'o1-mini', inputPer1k: 0.003, outputPer1k: 0.012, typicalJobCost: 0.018, notes: 'OpenAI reasoning (smaller)' },
  { model: 'claude-3.5-sonnet', inputPer1k: 0.003, outputPer1k: 0.015, typicalJobCost: 0.021, notes: 'Anthropic Sonnet 3.5' },
  { model: 'claude-3-opus', inputPer1k: 0.015, outputPer1k: 0.075, typicalJobCost: 0.105, notes: 'Anthropic Opus (premium)' },
  { model: 'claude-3-haiku', inputPer1k: 0.00025, outputPer1k: 0.00125, typicalJobCost: 0.00175, notes: 'Anthropic Haiku (budget)' },
  { model: 'gemini-1.5-pro', inputPer1k: 0.00125, outputPer1k: 0.005, typicalJobCost: 0.0075, notes: 'Google Gemini Pro' },
  { model: 'gemini-1.5-flash', inputPer1k: 0.000075, outputPer1k: 0.0003, typicalJobCost: 0.00045, notes: 'Google Gemini Flash' },
  { model: 'llama-3.1-70b', inputPer1k: 0.0009, outputPer1k: 0.0009, typicalJobCost: 0.0027, notes: 'Meta Llama 70B via API' },
  { model: 'llama-3.1-8b', inputPer1k: 0.0002, outputPer1k: 0.0002, typicalJobCost: 0.0006, notes: 'Meta Llama 8B via API' },
  { model: 'mixtral-8x7b', inputPer1k: 0.0006, outputPer1k: 0.0006, typicalJobCost: 0.0018, notes: 'Mistral MoE via API' },
  { model: 'deepseek-v2', inputPer1k: 0.00014, outputPer1k: 0.00028, typicalJobCost: 0.00056, notes: 'DeepSeek V2' },
  { model: 'self-hosted-7b', inputPer1k: 0.0001, outputPer1k: 0.0001, typicalJobCost: 0.0003, notes: 'Self-hosted 7B model' },
  { model: 'self-hosted-70b', inputPer1k: 0.0005, outputPer1k: 0.0005, typicalJobCost: 0.0015, notes: 'Self-hosted 70B model' },
];

type JobCategory = 'trivial' | 'simple' | 'medium' | 'complex' | 'premium';
type PrivacyTier = 'standard' | 'private' | 'sovereign';

const CATEGORY_MARKUPS: Record<JobCategory, { min: number; max: number }> = {
  trivial: { min: 2, max: 3 },
  simple: { min: 3, max: 5 },
  medium: { min: 5, max: 10 },
  complex: { min: 10, max: 20 },
  premium: { min: 20, max: 50 },
};

const PRIVACY_MULTIPLIERS: Record<PrivacyTier, number> = {
  standard: 1.0,
  private: 1.33,
  sovereign: 1.83,
};

const PLATFORM_FEE = 0.05;

const VALID_CATEGORIES = new Set(['trivial', 'simple', 'medium', 'complex', 'premium']);
const VALID_TIERS = new Set(['standard', 'private', 'sovereign']);

function round(n: number, d: number): number {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

export async function pricingRoutes(fastify: FastifyInstance): Promise<void> {

  // Rate limit: 30 requests per minute per IP
  fastify.get('/v1/pricing/recommend', {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: 60_000,
      },
    },
  }, async (request, reply) => {
    const q = request.query as Record<string, string>;

    // Parse params with defaults
    const model = q.model || 'gpt-4o-mini';
    const category = (q.category || 'simple') as JobCategory;
    const inputTokens = Math.max(0, parseInt(q.inputTokens || '2000', 10) || 2000);
    const outputTokens = Math.max(0, parseInt(q.outputTokens || '1000', 10) || 1000);
    const privacyTier = (q.privacyTier || 'standard') as PrivacyTier;
    const vrscUsdRate = parseFloat(q.vrscUsdRate || '1.0') || 1.0;

    // Validate
    if (!VALID_CATEGORIES.has(category)) {
      return reply.code(400).send({
        error: {
          code: 'INVALID_CATEGORY',
          message: `Invalid category. Must be one of: ${[...VALID_CATEGORIES].join(', ')}`,
        },
      });
    }

    if (!VALID_TIERS.has(privacyTier)) {
      return reply.code(400).send({
        error: {
          code: 'INVALID_PRIVACY_TIER',
          message: `Invalid privacy tier. Must be one of: ${[...VALID_TIERS].join(', ')}`,
        },
      });
    }

    const modelCost = LLM_COSTS.find(m => m.model === model);
    if (!modelCost) {
      return reply.code(400).send({
        error: {
          code: 'UNKNOWN_MODEL',
          message: `Unknown model: ${model}. Available: ${LLM_COSTS.map(m => m.model).join(', ')}`,
        },
      });
    }

    // Calculate
    const rawCost = (inputTokens / 1000) * modelCost.inputPer1k
                  + (outputTokens / 1000) * modelCost.outputPer1k;

    const privacyMultiplier = PRIVACY_MULTIPLIERS[privacyTier];
    const adjustedCost = rawCost * privacyMultiplier;
    const markup = CATEGORY_MARKUPS[category];
    const feeMultiplier = 1 + PLATFORM_FEE;
    const midMarkup = (markup.min + markup.max) / 2;

    const minUsd = adjustedCost * feeMultiplier;
    const recUsd = adjustedCost * midMarkup;
    const premUsd = adjustedCost * markup.max;
    const ceilUsd = premUsd * 1.5;

    const makePricePoint = (usd: number) => ({
      usd: round(usd, 6),
      vrsc: round(usd / vrscUsdRate, 6),
      marginPercent: adjustedCost > 0 ? round(((usd - adjustedCost) / adjustedCost) * 100, 1) : 0,
    });

    return {
      category,
      model,
      costBreakdown: {
        inputTokens,
        outputTokens,
        inputCostUsd: round((inputTokens / 1000) * modelCost.inputPer1k, 8),
        outputCostUsd: round((outputTokens / 1000) * modelCost.outputPer1k, 8),
        rawCostUsd: round(rawCost, 8),
        privacyTier,
        privacyMultiplier,
        adjustedCostUsd: round(adjustedCost, 8),
        platformFeePercent: PLATFORM_FEE * 100,
      },
      pricingRecommendation: {
        minimum: makePricePoint(minUsd),
        recommended: makePricePoint(recUsd),
        premium: makePricePoint(premUsd),
        ceiling: makePricePoint(ceilUsd),
      },
      marketIntel: {
        note: 'Market intelligence coming soon. This is a placeholder.',
        averagePrice: null,
        competitorCount: null,
      },
      tips: [
        `Category "${category}" typically commands ${markup.min}–${markup.max}x markup over cost.`,
        privacyTier !== 'standard'
          ? `Privacy tier "${privacyTier}" adds a ${round((privacyMultiplier - 1) * 100, 0)}% premium — buyers expect stronger guarantees.`
          : 'Standard privacy tier — no premium applied.',
        'Price in VRSC using current exchange rate. Adjust vrscUsdRate param for accuracy.',
        'Platform takes a 5% fee from the seller\'s payout.',
      ],
      vrscUsdRate,
    };
  });

  // List available models
  fastify.get('/v1/pricing/models', async () => {
    return {
      models: LLM_COSTS.map(m => ({
        model: m.model,
        inputPer1k: m.inputPer1k,
        outputPer1k: m.outputPer1k,
        typicalJobCost: m.typicalJobCost,
        notes: m.notes,
      })),
      categories: Object.entries(CATEGORY_MARKUPS).map(([name, range]) => ({
        name,
        markupMin: range.min,
        markupMax: range.max,
      })),
      privacyTiers: Object.entries(PRIVACY_MULTIPLIERS).map(([tier, multiplier]) => ({
        tier,
        multiplier,
        premiumPercent: round((multiplier - 1) * 100, 0),
      })),
    };
  });
}
