/**
 * Shared in-memory rate limiter.
 *
 * Each RateLimiter instance manages one Map of key → {count, resetAt}.
 * Stale entries are cleaned up every 5 minutes via a single shared timer.
 * Call stopAllCleanup() on graceful shutdown to clear the interval.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const allLimiters: RateLimiter[] = [];
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function ensureCleanup(): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const limiter of allLimiters) {
      limiter.cleanup(now);
    }
  }, 5 * 60 * 1000);
  cleanupInterval.unref();
}

/** Stop the shared cleanup timer (call on graceful shutdown). */
export function stopAllCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

// Hard cap on unique keys per limiter to prevent memory exhaustion
const MAX_KEYS_PER_LIMITER = 100_000;

export class RateLimiter {
  private store = new Map<string, RateLimitEntry>();

  constructor(
    /** Window duration in milliseconds. */
    public readonly windowMs: number,
    /** Max allowed requests per key per window. */
    public readonly max: number,
  ) {
    allLimiters.push(this);
    ensureCleanup();
  }

  /**
   * Check if `key` is within the rate limit.
   * Returns `true` if allowed, `false` if limit exceeded.
   */
  check(key: string): boolean {
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || entry.resetAt < now) {
      // Hard cap: reject new keys if map is at capacity (prevents memory exhaustion)
      if (!entry && this.store.size >= MAX_KEYS_PER_LIMITER) {
        return false;
      }
      this.store.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }

    if (entry.count >= this.max) {
      return false;
    }

    entry.count++;
    return true;
  }

  /** Remove expired entries (called by shared interval). */
  cleanup(now: number): void {
    for (const [key, entry] of this.store) {
      if (entry.resetAt < now) this.store.delete(key);
    }
  }
}
