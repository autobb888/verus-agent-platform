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
