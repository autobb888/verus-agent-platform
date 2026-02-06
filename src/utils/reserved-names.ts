// Reserved names that cannot be used for agent registration
// Includes variations to prevent impersonation

const RESERVED_BASE = [
  // Core system
  'verus',
  'vrsc',
  'official',
  'admin',
  'system',
  'support',
  'help',
  'moderator',
  'mod',
  'staff',
  'team',
  'verified',
  'root',
  'null',
  'undefined',
  'api',
  'www',
  'mail',
  'ftp',
  'localhost',
  // Platform
  'agent',
  'agents',
  'platform',
  'openclaw',
  'clawd',
  // AI companies
  'anthropic',
  'openai',
  'google',
  'microsoft',
  // Crypto/Finance (Shield P3)
  'bot',
  'wallet',
  'exchange',
  'bank',
  'coinbase',
  'binance',
  'kraken',
  'gemini',
  'treasury',
  'foundation',
];

// Build the set with lowercase versions
const reservedSet = new Set(RESERVED_BASE.map((n) => n.toLowerCase()));

export function isReservedName(name: string): boolean {
  const normalized = name.toLowerCase().trim();
  
  // Direct match
  if (reservedSet.has(normalized)) {
    return true;
  }

  // Check if name starts with or contains reserved names
  for (const reserved of RESERVED_BASE) {
    if (normalized.startsWith(reserved) || normalized.includes(`-${reserved}`) || normalized.includes(`_${reserved}`)) {
      return true;
    }
  }

  return false;
}

export function getReservedNames(): string[] {
  return [...RESERVED_BASE];
}
