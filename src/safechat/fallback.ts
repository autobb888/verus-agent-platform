/**
 * Fallback inline scanner — zero SafeChat module dependencies.
 * Provides basic inbound (injection) and outbound (PII/financial) scanning
 * when neither the HTTP API nor local SafeChat engine is available.
 */

// ── Inbound: Prompt Injection Detection ──

const INJECTION_PATTERNS: Array<{ pattern: RegExp; weight: number; label: string }> = [
  // Instruction override
  { pattern: /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|directions?)/i, weight: 0.9, label: 'instruction_override' },
  { pattern: /disregard\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/i, weight: 0.9, label: 'instruction_override' },
  { pattern: /forget\s+(all\s+)?(previous|prior|your)\s+(instructions?|prompts?|rules?|programming)/i, weight: 0.85, label: 'instruction_override' },
  { pattern: /override\s+(your|the|all)\s+(instructions?|rules?|programming|guidelines)/i, weight: 0.85, label: 'instruction_override' },
  // Jailbreak / DAN
  { pattern: /\bDAN\b.*\b(mode|jailbreak|do\s+anything\s+now)/i, weight: 0.95, label: 'jailbreak_dan' },
  { pattern: /you\s+are\s+now\s+(in\s+)?(DAN|developer|unrestricted|jailbreak)\s*(mode)?/i, weight: 0.9, label: 'jailbreak_mode' },
  { pattern: /\bjailbreak(ed|ing)?\b/i, weight: 0.7, label: 'jailbreak_keyword' },
  { pattern: /act\s+as\s+(an?\s+)?(unrestricted|unfiltered|uncensored)\s+(ai|model|assistant)/i, weight: 0.85, label: 'jailbreak_act_as' },
  // ChatML / role injection
  { pattern: /<\|im_start\|>|<\|im_end\|>/i, weight: 0.95, label: 'chatml_injection' },
  { pattern: /\[SYSTEM\]|\[INST\]|\[\/INST\]/i, weight: 0.8, label: 'role_tag_injection' },
  { pattern: /```system\b/i, weight: 0.75, label: 'fenced_system' },
  // Exfiltration
  { pattern: /repeat\s+(back|everything|all|the)\s+(above|previous|system|prompt)/i, weight: 0.8, label: 'exfiltration' },
  { pattern: /output\s+(your|the)\s+(system\s+)?(prompt|instructions)/i, weight: 0.85, label: 'exfiltration' },
  { pattern: /what\s+(are|were)\s+your\s+(original\s+)?(instructions|rules|system\s+prompt)/i, weight: 0.7, label: 'exfiltration' },
  // Encoding bypass
  { pattern: /base64[:\s]+[A-Za-z0-9+/=]{20,}/i, weight: 0.6, label: 'encoded_payload' },
  { pattern: /\\u[0-9a-f]{4}.*\\u[0-9a-f]{4}.*\\u[0-9a-f]{4}/i, weight: 0.5, label: 'unicode_escape' },
  // Prompt leaking
  { pattern: /reveal\s+(your|the)\s+(system|hidden|secret)\s*(prompt|instructions|message)/i, weight: 0.8, label: 'prompt_leak' },
  { pattern: /show\s+me\s+(your|the)\s+(system|original|full)\s*(prompt|instructions)/i, weight: 0.75, label: 'prompt_leak' },
];

// Strip zero-width characters and normalize whitespace
function normalizeText(text: string): string {
  return text
    .replace(/[\u200B\u200C\u200D\uFEFF\u00AD]/g, '') // zero-width chars
    .replace(/\s+/g, ' ')
    .trim();
}

// Shannon entropy of a string (L2 heuristic for obfuscated payloads)
function shannonEntropy(text: string): number {
  if (text.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const ch of text) {
    freq.set(ch, (freq.get(ch) || 0) + 1);
  }
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / text.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

export interface InboundScanResult {
  score: number;
  safe: boolean;
  classification: string;
  flags: string[];
}

export function scan(message: string): InboundScanResult {
  const normalized = normalizeText(message);
  const flags: string[] = [];
  let maxWeight = 0;

  for (const { pattern, weight, label } of INJECTION_PATTERNS) {
    if (pattern.test(normalized)) {
      flags.push(label);
      if (weight > maxWeight) maxWeight = weight;
    }
  }

  // Entropy check — high entropy on short-ish messages is suspicious
  if (normalized.length > 30 && normalized.length < 2000) {
    const entropy = shannonEntropy(normalized);
    if (entropy > 5.0) {
      flags.push('high_entropy');
      maxWeight = Math.max(maxWeight, 0.4);
    }
  }

  const score = Math.min(maxWeight, 1);
  let classification: string;
  if (score >= 0.7) classification = 'likely_injection';
  else if (score >= 0.3) classification = 'suspicious';
  else classification = 'safe';

  return {
    score,
    safe: classification === 'safe',
    classification,
    flags,
  };
}

// ── Outbound: PII / Financial / URL Scanning ──

// SSN: NNN-NN-NNNN (exclude obvious fakes like 000, 666, 9xx area)
const SSN_REGEX = /\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g;

// Credit card: 13-19 digit sequences with common separators
const CC_REGEX = /\b(?:\d[ -]*?){13,19}\b/g;

// BTC addresses (legacy + bech32)
const BTC_REGEX = /\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/g;
const BTC_BECH32_REGEX = /\bbc1[a-zA-HJ-NP-Z0-9]{25,90}\b/g;

// ETH addresses
const ETH_REGEX = /\b0x[a-fA-F0-9]{40}\b/g;

// VRSC addresses (R-address)
const VRSC_REGEX = /\bR[a-km-zA-HJ-NP-Z1-9]{25,34}\b/g;

// IP-based URLs (validate 0-255 octets)
const IP_URL_REGEX = /https?:\/\/(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)[^\s]*/gi;

// data: URI
const DATA_URI_REGEX = /data:[a-zA-Z]+\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]{50,}/gi;

function luhnCheck(digits: string): boolean {
  const nums = digits.replace(/\D/g, '');
  if (nums.length < 13) return false;
  let sum = 0;
  let alt = false;
  for (let i = nums.length - 1; i >= 0; i--) {
    let n = parseInt(nums[i], 10);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

interface OutputFlag {
  type: string;
  severity: string;
  detail: string;
  action: string;
}

export interface OutputScanResult {
  safe: boolean;
  score: number;
  classification: string;
  flags: OutputFlag[];
}

export function scanOutput(
  message: string,
  context: {
    jobId: string;
    jobCategory?: string;
    agentVerusId?: string;
    whitelistedAddresses?: Set<string>;
  },
): OutputScanResult {
  const flags: OutputFlag[] = [];
  const whitelist = context.whitelistedAddresses || new Set<string>();

  // SSN detection (regex already excludes 000/666/9xx area numbers)
  for (const match of message.matchAll(SSN_REGEX)) {
    flags.push({ type: 'ssn', severity: 'critical', detail: `SSN pattern: ${match[0].slice(0, 3)}-**-****`, action: 'redact' });
  }

  // Credit card detection with Luhn validation
  for (const match of message.matchAll(CC_REGEX)) {
    const digits = match[0].replace(/\D/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhnCheck(digits)) {
      flags.push({ type: 'credit_card', severity: 'critical', detail: `Card ending ${digits.slice(-4)}`, action: 'redact' });
    }
  }

  // Crypto addresses (respect whitelist)
  const cryptoPatterns: Array<{ regex: RegExp; type: string }> = [
    { regex: BTC_REGEX, type: 'btc_address' },
    { regex: BTC_BECH32_REGEX, type: 'btc_address' },
    { regex: ETH_REGEX, type: 'eth_address' },
    { regex: VRSC_REGEX, type: 'vrsc_address' },
  ];

  for (const { regex, type } of cryptoPatterns) {
    for (const match of message.matchAll(regex)) {
      if (!whitelist.has(match[0])) {
        flags.push({ type, severity: 'warning', detail: `Unwhitelisted ${type}: ${match[0].slice(0, 8)}...`, action: 'flag' });
      }
    }
  }

  // IP-based URLs
  for (const match of message.matchAll(IP_URL_REGEX)) {
    flags.push({ type: 'ip_url', severity: 'warning', detail: `IP-based URL: ${match[0].slice(0, 40)}`, action: 'flag' });
  }

  // data: URIs
  for (const match of message.matchAll(DATA_URI_REGEX)) {
    flags.push({ type: 'data_uri', severity: 'warning', detail: `data: URI (${match[0].length} chars)`, action: 'flag' });
  }

  const hasCritical = flags.some(f => f.severity === 'critical');
  const hasWarning = flags.some(f => f.severity === 'warning');
  const score = hasCritical ? 0.9 : hasWarning ? 0.5 : 0;

  return {
    safe: flags.length === 0,
    score,
    classification: hasCritical ? 'contains_pii' : hasWarning ? 'suspicious_content' : 'clean',
    flags,
  };
}
