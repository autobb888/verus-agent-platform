// Name flagging system for impersonation warnings
// Does NOT block registration - just flags for UI warnings

import { normalize } from './homoglyph.js';

export type FlagSeverity = 'none' | 'low' | 'medium' | 'high';

export interface NameFlag {
  flagged: boolean;
  severity: FlagSeverity;
  reasons: string[];
  warning?: string;
}

// Known brands/companies that might be impersonated
const KNOWN_BRANDS = [
  // Crypto
  { name: 'verus', category: 'blockchain', severity: 'high' as const },
  { name: 'vrsc', category: 'blockchain', severity: 'high' as const },
  { name: 'bitcoin', category: 'blockchain', severity: 'medium' as const },
  { name: 'ethereum', category: 'blockchain', severity: 'medium' as const },
  { name: 'coinbase', category: 'exchange', severity: 'high' as const },
  { name: 'binance', category: 'exchange', severity: 'high' as const },
  { name: 'kraken', category: 'exchange', severity: 'high' as const },
  { name: 'gemini', category: 'exchange', severity: 'high' as const },
  // AI
  { name: 'openai', category: 'ai', severity: 'high' as const },
  { name: 'anthropic', category: 'ai', severity: 'high' as const },
  { name: 'google', category: 'tech', severity: 'medium' as const },
  { name: 'microsoft', category: 'tech', severity: 'medium' as const },
  // Finance
  { name: 'bank', category: 'finance', severity: 'medium' as const },
  { name: 'wallet', category: 'finance', severity: 'low' as const },
  { name: 'exchange', category: 'finance', severity: 'low' as const },
  { name: 'treasury', category: 'finance', severity: 'medium' as const },
];

// Suspicious keywords that suggest official status
const OFFICIAL_KEYWORDS = [
  { word: 'official', severity: 'high' as const },
  { word: 'verified', severity: 'high' as const },
  { word: 'support', severity: 'medium' as const },
  { word: 'admin', severity: 'medium' as const },
  { word: 'team', severity: 'low' as const },
  { word: 'staff', severity: 'low' as const },
  { word: 'mod', severity: 'low' as const },
  { word: 'foundation', severity: 'medium' as const },
];

// System names that are suspicious for agents
const SYSTEM_NAMES = [
  { name: 'system', severity: 'medium' as const },
  { name: 'root', severity: 'medium' as const },
  { name: 'admin', severity: 'medium' as const },
  { name: 'api', severity: 'low' as const },
];

/**
 * Check if a name should be flagged for potential impersonation
 * Returns flag info for UI display - does NOT block registration
 */
export function checkNameFlags(name: string): NameFlag {
  const normalized = normalize(name).toLowerCase();
  const reasons: string[] = [];
  let maxSeverity: FlagSeverity = 'none';

  const updateSeverity = (newSeverity: FlagSeverity) => {
    const order: FlagSeverity[] = ['none', 'low', 'medium', 'high'];
    if (order.indexOf(newSeverity) > order.indexOf(maxSeverity)) {
      maxSeverity = newSeverity;
    }
  };

  // Check for known brand matches
  for (const brand of KNOWN_BRANDS) {
    if (normalized.includes(brand.name)) {
      reasons.push(`Name contains "${brand.name}" (${brand.category})`);
      updateSeverity(brand.severity);
    }
  }

  // Check for official-sounding keywords
  for (const kw of OFFICIAL_KEYWORDS) {
    if (normalized.includes(kw.word)) {
      reasons.push(`Contains "${kw.word}" - may imply official status`);
      updateSeverity(kw.severity);
    }
  }

  // Check for system name patterns
  for (const sys of SYSTEM_NAMES) {
    if (normalized === sys.name || normalized.startsWith(`${sys.name}-`) || normalized.startsWith(`${sys.name}_`)) {
      reasons.push(`Uses system-like name "${sys.name}"`);
      updateSeverity(sys.severity);
    }
  }

  // Check for homoglyph usage (using confusable characters)
  if (name !== normalize(name)) {
    reasons.push('Contains characters that could be confused with other letters (homoglyphs)');
    updateSeverity('high');
  }

  // Build warning message based on severity
  const warnings: Record<FlagSeverity, string | undefined> = {
    none: undefined,
    low: 'This agent name contains common terms. Verify before trusting.',
    medium: 'This agent name contains terms that may be misleading. Verify authenticity.',
    high: 'This agent name may be attempting impersonation. Exercise caution.',
  };
  const warning = warnings[maxSeverity];

  return {
    flagged: reasons.length > 0,
    severity: maxSeverity,
    reasons,
    warning,
  };
}

/**
 * Get flag info for API response
 */
export function getNameFlagInfo(name: string): { flagged: boolean; severity: string; warning?: string } {
  const flag = checkNameFlags(name);
  return {
    flagged: flag.flagged,
    severity: flag.severity,
    warning: flag.warning,
  };
}
