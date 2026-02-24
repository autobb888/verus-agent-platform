/**
 * Safe JSON parsing for untrusted database-stored strings.
 * Returns fallback value on parse failure instead of throwing.
 */
export function safeJsonParse<T = any>(str: string | null | undefined, fallback: T = null as T): T {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}
