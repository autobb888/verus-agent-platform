import { remove as removeConfusables } from 'confusables';

/**
 * Detect if a name contains homoglyph characters that could be used for impersonation.
 * Uses the confusables library to normalize and compare.
 */
export function hasHomoglyphs(name: string): boolean {
  // Remove confusable characters and compare
  const normalized = removeConfusables(name);
  
  // If removing confusables changes the string, it had confusables
  return normalized !== name;
}

/**
 * Get the normalized version of a name with confusables removed
 */
export function normalize(name: string): string {
  return removeConfusables(name);
}

/**
 * Check if two names are confusable (look similar after normalization)
 */
export function areConfusable(name1: string, name2: string): boolean {
  return removeConfusables(name1) === removeConfusables(name2);
}

/**
 * Check if name contains homoglyph attack characters.
 * Returns detailed info about what was detected.
 */
export interface HomoglyphCheckResult {
  isAttack: boolean;
  normalized: string;
  confusedWith?: string[];
}

export function hasHomoglyphAttack(name: string): HomoglyphCheckResult {
  const normalized = removeConfusables(name);
  const isAttack = normalized !== name;
  
  if (!isAttack) {
    return { isAttack: false, normalized };
  }
  
  // Find which characters were confusable
  const confusedWith: string[] = [];
  for (let i = 0; i < name.length; i++) {
    const char = name[i];
    const normalizedChar = removeConfusables(char);
    if (char !== normalizedChar) {
      confusedWith.push(`'${char}' → '${normalizedChar}'`);
    }
  }
  
  return {
    isAttack: true,
    normalized,
    confusedWith: [...new Set(confusedWith)], // Unique entries
  };
}
