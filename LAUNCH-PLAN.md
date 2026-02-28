# VAP Launch Plan — 20-Pass Audit Results

> Generated: 2026-02-27 | Across 6 repos, 20 passes, ~200 findings
> Repos: verus-platform, safechat, vap-agent-sdk, mcp-server-vap, vap-dispatcher, safechat-sdk

---

## Executive Summary

**App-level security is strong** — no SQL injection, XSS mitigated, CSRF covered, SSRF protected, file uploads secure, all 52 frontend API calls match backend routes, 128-fix security audit already applied.

**What's broken:** The ecosystem can't run as a whole. vap-agent-sdk has no compiled output, so MCP server and dispatcher are non-functional. Multiple response shape mismatches between SDK and platform. Missing operational infrastructure (no process manager, no SSL config, no backups, no monitoring).

**Estimated capacity:** ~200-300 concurrent active users before SQLite write bottleneck hits. Read-only browsing scales higher.

---

## TIER 1 — BLOCKING (Must fix before launch)

### T1-1. Build the SDK (everything depends on it)
- **Problem:** `vap-agent-sdk/dist/` does not exist. MCP server, dispatcher, and Docker builds all fail.
- **Fix:** `cd ~/vap-agent-sdk && npm run build`
- **Then:** `cd ~/mcp-server-vap && npm install && npm run build`
- **Then:** `cd ~/safechat && npm run build`
- **Files:** All repos
- **Severity:** CRITICAL — 3 repos completely non-functional

### T1-2. Fix SDK ↔ Platform response shape mismatch (transactions)
- **Problem:** Platform's `/v1/tx/*` endpoints return raw objects (`{txid, status}`). SDK expects `{data: {txid, status}}`. All 4 transaction SDK methods return `undefined`.
- **Fix:** Either wrap platform transaction responses in `{data: ...}` envelope (consistent with all other routes), OR change SDK to not unwrap.
- **Files:** `verus-platform/src/api/routes/transactions.ts:80,123,257,310` + `vap-agent-sdk/src/client/index.ts:138,144,150,156`
- **Severity:** CRITICAL — all chain info, UTXO, broadcast, tx status broken for SDK/MCP consumers

### T1-3. Fix SDK calling nonexistent route
- **Problem:** `VAPClient.updateAgentProfile()` calls `PATCH /v1/me/agent` — this route doesn't exist. Returns 404.
- **Fix:** Either create the route on the platform, or remove/redirect the SDK method to `POST /v1/agents/:id/update`.
- **Files:** `vap-agent-sdk/src/client/index.ts:417-420`
- **Severity:** CRITICAL

### T1-4. Fix SafeChat endpoint path mismatch
- **Problem:** VAP calls `/v1/scan` but self-hosted SafeChat serves `/scan` (no prefix). Cloud server works fine.
- **Fix:** Either add `/v1/` prefix to self-hosted SafeChat routes, or make VAP client strip the prefix when connecting to self-hosted mode.
- **Files:** `safechat/src/server.ts:54` vs `verus-platform/src/safechat/client.ts:88`
- **Severity:** CRITICAL — self-hosted SafeChat scanning silently fails

### T1-5. Add process manager
- **Problem:** `npm start` with no auto-restart. One uncaught exception kills the service permanently.
- **Fix:** Add pm2 ecosystem config or systemd service files for: VAP, SafeChat, and Dispatcher.
- **Deliverable:** `ecosystem.config.cjs` with all services
- **Severity:** CRITICAL

### T1-6. Configure SSL/TLS
- **Problem:** No reverse proxy config. Cookies are `secure: true` in production — entire auth system breaks without HTTPS.
- **Fix:** Create nginx/Caddy config with SSL termination. Document certificate setup.
- **Deliverable:** `deploy/nginx.conf` or `deploy/Caddyfile`
- **Severity:** CRITICAL

### T1-7. Implement backup strategy
- **Problem:** No automated backups for SQLite DB or file uploads. One disk failure = total data loss.
- **Fix:** Cron job using existing `scripts/backup-db.sh` (already written but not scheduled). Add file backup.
- **Deliverable:** Cron config + tested restore procedure
- **Severity:** CRITICAL

### T1-8. Add error alerting
- **Problem:** `uncaughtException` handler only logs and exits. No notification to ops.
- **Fix:** Add webhook notification on crash (Discord/Slack webhook, or Sentry). Minimum viable: pipe pm2 logs to a webhook on error.
- **Severity:** CRITICAL

### T1-9. Write deployment guide
- **Problem:** No step-by-step production setup instructions. Startup order undocumented.
- **Fix:** Create `DEPLOY.md` covering: server provisioning, Verus daemon setup, env config, build steps, SSL, DNS, startup order (daemon → SafeChat → VAP → Dispatcher), verification checklist.
- **Severity:** CRITICAL

### T1-10. Fix mcp-server-vap .gitignore
- **Problem:** `.gitignore` doesn't exclude `.env` files. Any secrets will be committed.
- **Fix:** Add `.env`, `.env.*`, `!.env.example` to `.gitignore`
- **Files:** `mcp-server-vap/.gitignore`
- **Severity:** CRITICAL

---

## TIER 2 — HIGH PRIORITY (Should fix before launch)

### T2-1. Fix WebSocket reconnection (one-time tokens)
- **Problem:** Chat tokens are consumed on first connect. Socket.IO reconnection reuses stale token → rejected. Agents lose chat on any network blip.
- **Fix:** Either issue new token on reconnect, or allow token reuse within a short window (e.g., 60s) from the same session.
- **Files:** `verus-platform/src/chat/ws-server.ts:153`, `vap-agent-sdk/src/chat/client.ts:125-135`

### T2-2. Fix read receipt event name mismatch
- **Problem:** SDK emits `mark_read`, server listens for `read`. Agent read receipts are silently dropped.
- **Fix:** Change SDK to emit `read`, or change server to listen for `mark_read`.
- **Files:** `vap-agent-sdk/src/chat/client.ts:311` vs `verus-platform/src/chat/ws-server.ts:629`

### T2-3. Add hold queue API routes
- **Problem:** Hold queue functions exist (getHeld, appeal, release, reject) but no API routes expose them. Held messages are stuck forever.
- **Fix:** Add routes under `/v1/me/hold-queue` or `/v1/jobs/:id/held-messages`.
- **Files:** `verus-platform/src/chat/hold-queue.ts` — all management functions orphaned

### T2-4. Schedule autoReleaseExpired() for hold queue
- **Problem:** `autoReleaseExpired()` is never called. Held messages stay in `'held'` status permanently.
- **Fix:** Add to worker loop or create a separate interval.
- **Files:** `verus-platform/src/chat/hold-queue.ts:113`

### T2-5. Fix released messages never delivered
- **Problem:** `releaseMessage()` changes status to `'released'` but never inserts into `job_messages` or broadcasts via Socket.IO.
- **Fix:** After status update, insert into `job_messages` and emit via Socket.IO.
- **Files:** `verus-platform/src/chat/hold-queue.ts:84-94`

### T2-6. Move agent_canaries table to migrations.ts
- **Problem:** `agent_canaries` table + `communication_policy`/`external_channels` ALTER TABLEs are in `canary.ts` route handler, not migrations. If canary route isn't registered first, `ws-server.ts` crashes querying non-existent table.
- **Fix:** Move all DDL to `migrations.ts`.
- **Files:** `verus-platform/src/api/routes/canary.ts:33-41,114-118` → `verus-platform/src/db/migrations.ts`

### T2-7. Fix schema.ts type mismatches
- **Problem:** `Agent` interface missing `'hybrid'` type and 3 columns (`startup_recouped`, `communication_policy`, `external_channels`).
- **Fix:** Update `schema.ts` to match actual DB schema.
- **Files:** `verus-platform/src/db/schema.ts:8` and throughout

### T2-8. Fix mixed timestamp types
- **Problem:** `auth_challenges`/`sessions` use INTEGER (epoch ms), `chat_tokens`/`inbox` use TEXT (ISO). One wrong comparison = silent cleanup failure.
- **Fix:** Standardize on one format (INTEGER epoch ms recommended). Migrate TEXT columns.
- **Files:** `verus-platform/src/db/migrations.ts` — multiple tables

### T2-9. Add QR challenge cleanup
- **Problem:** Auth cleanup interval deletes from `auth_challenges` but NOT `qr_challenges`. Table grows unbounded.
- **Fix:** Add `DELETE FROM qr_challenges WHERE expires_at < ?` to cleanup interval.
- **Files:** `verus-platform/src/api/routes/auth.ts:56-78`

### T2-10. Add missing ON DELETE CASCADE
- **Problem:** `alert_reports.alert_id`, `webhook_deliveries.webhook_id`, SafeChat `api_keys.tenant_id`/`usage.tenant_id` — all missing CASCADE. Deleting parents fails or orphans children.
- **Fix:** Add CASCADE in migrations (requires recreating tables in SQLite).
- **Files:** `verus-platform/src/db/migrations.ts:335,496`, `safechat/src/tenant/db.ts:48,58`

### T2-11. Remove dead dependencies
- **Problem:** `bullmq`, `ioredis`, `@fastify/websocket` in package.json but never imported. Adds ~20MB to node_modules.
- **Fix:** `npm uninstall bullmq ioredis @fastify/websocket`
- **Files:** `verus-platform/package.json`

### T2-12. Add response compression
- **Problem:** No gzip/brotli on API responses or static assets.
- **Fix:** `npm install @fastify/compress` + register in server.ts
- **Files:** `verus-platform/src/api/server.ts`

### T2-13. Add static asset caching headers
- **Problem:** Dashboard JS/CSS bundles served without Cache-Control. Every page load re-downloads everything.
- **Fix:** Configure `@fastify/static` with `maxAge` for hashed assets.
- **Files:** `verus-platform/src/api/server.ts`

### T2-14. Fix Dockerfile.dispatcher (wrong CLI version)
- **Problem:** `Dockerfile.dispatcher` runs v1 CLI (`src/cli.js`), but active code is v2 (`src/cli-v2.js`).
- **Fix:** Change CMD to `["node", "src/cli-v2.js", "start"]`
- **Files:** `vap-dispatcher/Dockerfile.dispatcher:23`

### T2-15. Fix Dockerfile.agent (broken multi-stage build)
- **Problem:** `COPY --from=vap-sdk` references non-existent build stage. Cannot build.
- **Fix:** Either add a vap-sdk build stage or copy from the host build context.
- **Files:** `vap-dispatcher/Dockerfile.agent:16-17`

### T2-16. Add dispatcher SIGTERM handler
- **Problem:** Only handles SIGINT, not SIGTERM. Docker/K8s sends SIGTERM → hard kill → orphan containers.
- **Fix:** Add `process.on('SIGTERM', shutdown)` alongside SIGINT.
- **Files:** `vap-dispatcher/index.js:336`

### T2-17. Add fetch timeouts to dispatcher
- **Problem:** All fetch calls in `vap-client.js` have no timeout. Hangs indefinitely if VAP API is unresponsive.
- **Fix:** Add `signal: AbortSignal.timeout(30000)` to all fetch calls.
- **Files:** `vap-dispatcher/vap-client.js:19,24,51,57`, `vap-dispatcher/src/job-agent.js:257,271`

### T2-18. Fix dispatcher bridge secret default
- **Problem:** `VAP_BRIDGE_SECRET` defaults to `'dev-secret-change-in-production'` with no production guard.
- **Fix:** Add `if (process.env.NODE_ENV === 'production' && !process.env.VAP_BRIDGE_SECRET) throw`
- **Files:** `vap-dispatcher/src/bridge.js:20`

### T2-19. Add COOKIE_SECRET minimum length validation
- **Problem:** Any non-empty string accepted as cookie secret in production. `"a"` would pass.
- **Fix:** Check `COOKIE_SECRET.length >= 64` (32 bytes hex) in production.
- **Files:** `verus-platform/src/api/server.ts:82`

### T2-20. Fix docs/API.md phantom endpoints
- **Problem:** Documents `GET /v1/register/nonce`, `POST /v1/register`, `PUT /v1/register/:verusId`, `GET /v1/agents/:id/endpoints` — none exist.
- **Fix:** Remove phantom entries, add missing 40+ endpoints.
- **Files:** `verus-platform/docs/API.md:47,413-415`

### T2-21. Fix README auth example (wrong field names)
- **Problem:** README shows `{nonce, message}` but actual API returns `{challengeId, challenge, expiresAt}`.
- **Fix:** Update README examples to match actual API.
- **Files:** `verus-platform/README.md:113-123`

### T2-22. Add .env.example to dispatcher and MCP server
- **Problem:** Dispatcher has 30+ env vars with zero documentation. MCP server has none either.
- **Fix:** Create `.env.example` files in both repos.
- **Files:** `vap-dispatcher/.env.example` (new), `mcp-server-vap/.env.example` (new)

### T2-23. Add RPC rate limiting / circuit breaker
- **Problem:** Public endpoints can trigger 2-3 RPC calls each. At 100 HTTP req/min → ~300 RPC calls/min. Could overwhelm the Verus daemon.
- **Fix:** Add a simple rate limiter or circuit breaker around the RPC client.
- **Files:** `verus-platform/src/indexer/rpc-client.ts`

### T2-24. Convert synchronous file I/O to async
- **Problem:** `readFileSync`/`writeFileSync` in storage.ts block the event loop for up to 25MB files.
- **Fix:** Convert to `fs/promises` equivalents.
- **Files:** `verus-platform/src/files/storage.ts`

### T2-25. Add MCP tools for end-session and platform-fee
- **Problem:** No MCP tool for `requestEndSession()` or `recordPlatformFee()`. MCP agents can't complete the standard job flow.
- **Fix:** Add `vap_end_session` and `vap_record_platform_fee` tools.
- **Files:** `mcp-server-vap/src/tools/` (new tools)

### T2-26. Fix revalidateInterval not .unref()'d
- **Problem:** Per-connection interval at `ws-server.ts:253` prevents clean shutdown.
- **Fix:** Add `.unref()` to the interval.
- **Files:** `verus-platform/src/chat/ws-server.ts:253`

### T2-27. Sanitize dispatcher error responses
- **Problem:** Express error handler at `api.js:94-96` leaks `err.message` (filesystem paths, Docker errors) to clients.
- **Fix:** Return generic error messages; log details server-side only.
- **Files:** `vap-dispatcher/src/api.js:44,57,68,78,94-96`

---

## TIER 3 — MEDIUM PRIORITY (Should fix soon after launch)

### T3-1. Payment verification is advisory only
- Jobs transition to `in_progress` regardless of payment verification result. Buyer can submit arbitrary txids.
- **Files:** `verus-platform/src/api/routes/jobs.ts:1380`

### T3-2. No txid deduplication
- Same on-chain txid can be submitted for multiple jobs.
- **Files:** `verus-platform/src/api/routes/jobs.ts:1376`

### T3-3. No auto-expiry for stale `requested` jobs
- Jobs never accepted stay in `requested` forever.
- **Files:** `verus-platform/src/worker/index.ts`

### T3-4. End-session doesn't change job status
- Purely signaling — job stays `in_progress` indefinitely if no follow-up.
- **Files:** `verus-platform/src/api/routes/jobs.ts:771-853`

### T3-5. Public job endpoints expose all data unauthenticated
- `GET /v1/jobs/:id` returns everything including payment txids and all signatures.
- **Files:** `verus-platform/src/api/routes/jobs.ts:252-280`

### T3-6. CSP disabled globally
- `contentSecurityPolicy: false` — SPA served in production without CSP headers.
- **Files:** `verus-platform/src/api/server.ts:74`

### T3-7. Onboard retry has no auth
- `POST /v1/onboard/retry/:id` — anyone knowing UUID can retry. Should verify signature or IP.
- **Files:** `verus-platform/src/api/routes/onboard.ts:463-465`

### T3-8. SafeChat missing busy_timeout
- Concurrent writes can immediately fail with SQLITE_BUSY.
- **Files:** `safechat/src/tenant/db.ts:14-16`

### T3-9. Missing indexes on cleanup columns
- `chat_tokens(expires_at)`, `qr_challenges(expires_at)` — cleanup queries scan full tables.
- **Files:** `verus-platform/src/db/migrations.ts`

### T3-10. Missing UNIQUE constraint on webhooks(agent_verus_id, url)
- Same agent can register same URL multiple times → duplicate deliveries.
- **Files:** `verus-platform/src/db/migrations.ts`

### T3-11. Pricing tables manually synced between repos
- `vap-agent-sdk/src/pricing/tables.ts` and `verus-platform/src/api/routes/pricing.ts` — comment-based sync warning only.
- **Files:** Both repos

### T3-12. Dispatcher job-agent processJob is a stub
- Returns dummy string after 5s timeout. No actual LLM call.
- **Files:** `vap-dispatcher/src/job-agent.js:295-306`

### T3-13. Dispatcher containers run as root
- `USER vap-agent` commented out in Dockerfile.job-agent.
- **Files:** `vap-dispatcher/Dockerfile.job-agent:62`

### T3-14. Undocumented env vars across repos
- `LOGIN_SERVICE_URL`, `PLATFORM_WALLET_ADDRESS`, `CHAIN` used but not in .env.example.
- **Files:** `verus-platform/.env.example`

### T3-15. Dead env vars in .env.example
- `PLATFORM_SIGNING_ADDRESS`, `PLATFORM_CHAIN_IADDRESS` documented but never read by code.
- **Files:** `verus-platform/.env.example`

### T3-16. Hardcoded filesystem paths in dispatcher
- `/home/bb/verus-wiki/docs`, `/home/vap-av1/.vap-keys.json` — fail on any other machine.
- **Files:** `vap-dispatcher/config.js:27`, `vap-dispatcher/onboard-ari3.cjs:19`

### T3-17. No outbound scanning via HTTP API
- If only `SAFECHAT_API_URL` is set (no `SAFECHAT_PATH`), outbound scanning falls to simple regex — misses PII, financial, contamination scanners.
- **Files:** `verus-platform/src/safechat/client.ts:130-166`

### T3-18. SDK payment module is stub
- `buildPayment()` and `selectUtxos()` throw `Error('Not implemented')` but are exported as public API.
- **Files:** `vap-agent-sdk/src/tx/payment.ts:3`

### T3-19. Stale README counts
- "React 18" (actually 19), "27 routes" (actually 29), "11 pages" (actually 14), "169 SafeChat tests" (actually 323).
- **Files:** `verus-platform/README.md`

### T3-20. JSON.parse without safeJsonParse in ws-server
- `ws-server.ts:302` uses raw `JSON.parse(service.session_params)` — has try/catch but breaks convention.
- **Files:** `verus-platform/src/chat/ws-server.ts:302`

---

## TIER 4 — NICE TO HAVE (Post-launch improvements)

### T4-1. Add test suite to verus-platform (currently `echo "TODO"`)
### T4-2. Add CI/CD pipelines (only SafeChat has GitHub Actions)
### T4-3. Implement Redis-backed sessions/nonces for horizontal scaling
### T4-4. Add Socket.IO Redis adapter for multi-process WebSocket
### T4-5. Batch RPC calls in indexer (currently sequential per-tx)
### T4-6. Add caching layer for read-heavy endpoints (agents, services, search)
### T4-7. Add database migration versioning (currently IF NOT EXISTS pattern)
### T4-8. Publish @autobb/vap-agent to npm (currently file: references only)
### T4-9. Add Prometheus metrics + Grafana dashboard
### T4-10. Add log rotation and structured log aggregation
### T4-11. Implement proper job queue (BullMQ) replacing polling worker
### T4-12. Add "logout all sessions" endpoint for compromised identities
### T4-13. Add absolute maximum session lifetime (currently sliding window only)
### T4-14. Unify SDK architecture in dispatcher (3 different SDK references)
### T4-15. Convert dispatcher from JavaScript to TypeScript

---

## Quick Stats

| Metric | Count |
|--------|-------|
| Total findings | ~150 |
| CRITICAL (Tier 1) | 10 |
| HIGH (Tier 2) | 27 |
| MEDIUM (Tier 3) | 20 |
| LOW (Tier 4) | 15 |
| Frontend API alignment | 52/52 matched |
| Security vulns (OWASP) | 0 critical |
| Registered endpoints | 93 |
| Documented endpoints | ~53 (57% coverage) |
| Repos that can run | 2/6 (VAP + SafeChat engine only) |

---

## Recommended Execution Order

```
Phase 1 — Make it buildable (T1-1, T1-10)
  Build SDK → Install MCP deps → Build MCP → Build SafeChat
  Fix .gitignore

Phase 2 — Make it correct (T1-2, T1-3, T1-4, T2-1, T2-2, T2-5, T2-6, T2-7)
  Fix response shapes, missing routes, event names
  Move DDL to migrations, fix schema types

Phase 3 — Make it deployable (T1-5, T1-6, T1-7, T1-8, T1-9)
  pm2 config, nginx/SSL, backup cron, error alerting, deploy guide

Phase 4 — Make it robust (T2-3 through T2-27)
  Hold queue, cleanup, rate limiting, Dockerfiles, docs

Phase 5 — Make it complete (T3-*, T4-*)
  Payment hardening, testing, monitoring, scaling
```
