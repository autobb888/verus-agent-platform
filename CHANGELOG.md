# Changelog

## [Unreleased] — 2026-02-24

### Security Hardening (128 fixes across 52 files)

Systematic security audit covering all backend routes, database queries, WebSocket handlers, SDK, and frontend components.

#### Critical (6 fixes)
- **SQL injection** — Column interpolation in `countByStatus`, agent/service sort queries replaced with whitelist lookups
- **Command injection** — SDK signer uses `execFile` instead of `exec`, with verusId format validation
- **Unhandled promise rejection** — `indexLoop()` wrapped in top-level catch to prevent silent crash
- **RPC timeout** — 30s timeout via `AbortController` prevents indefinite hangs
- **WebSocket DoS** — Per-socket message rate limiting (200ms min gap, 30/min burst cap)
- **Login service timeout** — 10s `AbortController` on external auth fetch calls

#### High (30 fixes)
- Signature verification against resolved buyer/seller i-addresses (accept, review endpoints)
- Atomic transaction wrapping for dual DB updates (verification, webhook ownership)
- Seller ownership check on `setInProgress` state transition
- Deeplink protocol validation (`verus://` only) in frontend auth/job components
- Timestamp freshness validation (±10 min) on all signed job lifecycle actions
- Delivery hash format validation (hex, 16-128 chars)
- Extension payment requires at least one txid, amount capped at 1M
- Hex format + IV/auth tag length validation in encryption utilities
- Symlink protection + UUID validation + path traversal prevention in file storage
- VDXF value parsing DoS protection (20KB hex cap, array bounds of 100)
- Circuit breaker auto-unpause after 5 minutes (prevents permanent chat DoS)
- LRU cache size caps (10K entries) on transparency + name resolution caches
- SDK `baseUrl` protocol enforcement (http/https only) + sanitized network errors
- Unbounded TX input loop capped at 50 iterations
- DB query LIMIT clauses on `getUnreadJobs` (100) and `getExpiredJobFiles` (1000)
- Content-Disposition filename sanitization (strip control chars)

#### Medium (75 fixes)
- `NaN`/`Infinity` guards on all `parseFloat` and numeric config values
- `parseInt` radix 10 on all 31 calls across codebase
- `safeJsonParse` wrapper on all 9 `JSON.parse` call sites
- `.unref()` on all 12 `setInterval` timers (prevents process hang on shutdown)
- Per-endpoint rate limits on all state-changing authenticated routes
- WebSocket read receipt throttle (1/sec per socket)
- Typing indicator throttle (500ms per socket)
- Pagination bounds (limit 1-100, offset >= 0) on service/search endpoints
- Currency field max length (20 chars)
- Timestamp format validation on `since` parameters
- Bounded unicode escape regex in SafeChat fallback scanner
- Extended zero-width character stripping
- Rate limiter map size hard cap (100K keys)
- SessionScorer LRU converted to O(1) via Map delete+re-set
- `safeInt()` config helper: NaN/negative/zero fall back to defaults
- Notification cleanup (read >7d, all >90d) with 6-hour periodic timer
- DB indexes on `notifications.created_at` and `hold_queue.created_at`
- Error message sanitization (don't expose raw RPC/internal errors)
- Retry TTL (7 days max) on agent onboarding
- Hold queue appeal reason truncated to 2000 chars
- Frontend `maxLength` attributes on all textarea/input fields

#### Low (17 fixes)
- Dead code removal (unused variables, functions)
- Comment mismatches corrected
- Unused parameter markers (`_param` convention)

### Cross-Cutting Verification
- All `JSON.parse` calls protected with try-catch (9 locations)
- All `parseInt` calls use radix 10 (31 calls)
- All `parseFloat` results guarded with `Number.isFinite`
- All `setInterval` calls have `.unref()` (12 intervals)
- No ReDoS vulnerabilities
- No uncaught promise rejections
- No sensitive data in `console.log`
- No SQL injection (all dynamic SQL uses column whitelists)
- No command injection (only `execFile`, no `exec`/`execSync`)
- All state-changing endpoints have per-endpoint rate limits
