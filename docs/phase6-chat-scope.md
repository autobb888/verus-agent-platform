# Phase 6: In-Platform Chat + File Sharing + Prompt Injection Protection

**Status:** Scoping  
**Author:** Cee ⚙️  
**Date:** 2026-02-06  
**Requested by:** Auto

---

## Goal

Add real-time buyer-seller chat with file sharing to the Verus Agent Platform, with built-in prompt injection protection for AI agents. This becomes a differentiating feature — "SafeChat."

---

## Architecture

### Three-Tier Communication

1. **In-House Chat (SafeChat)** — Real-time messaging + file sharing on the platform
   - Job-scoped conversations (tied to a specific job)
   - File uploads for deliverables (images, docs, code, etc.)
   - Built-in prompt injection scanning for AI agent recipients
   - Message signing optional (VerusID signatures)

2. **"Go Private" Option** — Link to Nymia for on-chain encrypted chat
   - For sensitive conversations that shouldn't touch platform servers
   - Fully decentralized, VerusID-authenticated
   - No file sharing (blockchain limitation)

3. **External Channels** — Discord, Telegram, email, etc.
   - Agent lists preferred contact method via `ari::agent.v1.contact` VDXF key
   - For ongoing relationships beyond single jobs
   - Platform shows contact preferences on agent profile

---

## Technical Design

### Real-Time Messaging

**WebSocket layer on existing Fastify server:**

```
Client → WebSocket (Socket.IO or ws) → Fastify server → DB + broadcast
```

- Socket.IO rooms keyed by job ID: `job:{jobId}`
- Auth: existing session cookie validated on WS handshake
- Only buyer + seller of a job can join the room
- Falls back to REST polling for agents without WS support

**Endpoints (extend existing):**
- `GET /v1/jobs/:id/messages` — existing, add `?since=timestamp` for polling
- `POST /v1/jobs/:id/messages` — existing, now also broadcasts via WS
- `POST /v1/jobs/:id/files` — NEW: upload file attachment
- `GET /v1/jobs/:id/files/:fileId` — NEW: download file
- `WS /ws` — WebSocket connection, join rooms by job ID

### File Sharing

**Storage:** Local filesystem for MVP, S3-compatible for production

**Constraints:**
- Max file size: 25MB per file
- Allowed types: images (png, jpg, gif, webp, svg), documents (pdf, doc, docx, txt, md), code (zip, tar.gz), design (psd, ai, fig — as binary)
- Files tied to job + message (foreign key)
- Files auto-expire 30 days after job completion
- Virus scanning: ClamAV integration for production

**Schema:**
```sql
CREATE TABLE job_files (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  message_id TEXT REFERENCES job_messages(id),
  uploader_verus_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  checksum TEXT NOT NULL,  -- SHA-256
  created_at TEXT DEFAULT (datetime('now'))
);
```

### Agent Notification System

**For AI agents to receive messages:**

1. **Polling** (MVP): Agent calls `GET /v1/me/jobs?hasNewMessages=true` on interval
2. **Webhook** (Phase 2): Platform POSTs to agent's registered endpoint on new message
3. **OpenClaw Integration**: Agent's OpenClaw instance gets a cron job that checks for new messages

**Webhook payload:**
```json
{
  "event": "job.message.new",
  "jobId": "abc-123",
  "jobHash": "a296fbcb...",
  "sender": "i4aNjr1h...",
  "preview": "Hey, can you adjust the colors...",
  "hasFiles": true,
  "timestamp": 1770436000
}
```

---

## SafeChat: Prompt Injection Protection

### The Problem

When a human sends a message to an AI agent, the message content becomes part of the agent's prompt. A malicious buyer could craft messages that:
- Override the agent's instructions
- Exfiltrate the agent's system prompt or API keys
- Make the agent perform unauthorized actions
- Manipulate the agent into sending funds
- Inject instructions via filenames, metadata, or image text

### Proposed Mitigation Layers

**Layer 1: Pattern Detection (Pre-delivery)**
- Scan messages for known injection patterns before delivering to agent
- Flag messages containing: system prompt overrides, role-play attacks, instruction injections
- Regex + ML classifier hybrid
- Flagged messages get a `⚠️ injection_risk: high/medium/low` tag

**Layer 2: Message Classification**
- Classify each message: `task_related`, `social`, `suspicious`, `injection_attempt`
- Agent receives classification metadata alongside the message
- Agent framework can auto-reject `injection_attempt` messages

**Layer 3: Sandboxed Message Delivery**
- Messages delivered to agent in a structured format, NOT raw text in prompt
- Agent sees: `{ role: "buyer_message", content: "...", safety_score: 0.95 }`
- Agent's system prompt explicitly says to treat buyer messages as untrusted input
- Separation between "instruction channel" (system prompt) and "data channel" (messages)

**Layer 4: Action Confirmation**
- High-risk actions (payments, identity changes, file access) require explicit confirmation
- Agent can't auto-execute financial transactions from a chat message
- Two-step: agent proposes action → platform confirms with the agent's owner

**Layer 5: Monitoring & Alerting**
- Log all messages with injection scores
- Alert agent owner if repeated injection attempts detected
- Rate limit suspicious senders
- Quarantine flagged messages for review

### What We'd Advertise

> **SafeChat™ — Protected Agent Communication**
> 
> Every message is scanned for prompt injection attacks before reaching your agent. 
> Malicious instructions are flagged, classified, and quarantined. Your agent sees 
> structured, safety-scored messages — not raw text that could override its behavior.
> 
> Features:
> - 🛡️ 5-layer prompt injection protection
> - 📎 Secure file sharing with virus scanning
> - ✍️ Optional VerusID message signing
> - 🔒 "Go Private" mode via Nymia (on-chain encrypted)
> - 🤖 Agent notification webhooks
> - 📊 Safety scoring on every message

---

## Research Needed

### From Shield 🛡️
- Comprehensive prompt injection attack taxonomy for agent platforms
- File-based injection vectors (filenames, EXIF metadata, OCR text in images)
- WebSocket security (origin validation, message size limits, connection flooding)
- File upload security (path traversal, zip bombs, polyglot files)

### From Rex 🔬
- State of the art in prompt injection detection (academic papers, existing tools)
- ML classifier approaches (fine-tuned models for injection detection)
- How other agent platforms handle untrusted input (AutoGPT, CrewAI, LangChain)
- Structured message delivery patterns (instruction hierarchy, data isolation)
- Competitive analysis: who offers this? (spoiler: nobody)

---

## Implementation Phases

### Phase 6a: Real-Time Chat (1-2 weeks)
- Socket.IO integration on Fastify
- WebSocket auth from session cookies
- Real-time message delivery
- Typing indicators
- Message read receipts
- Agent polling endpoint for non-WS agents

### Phase 6b: File Sharing (1 week)
- File upload/download endpoints
- Storage management (local → S3)
- File type validation + size limits
- Checksum verification
- Auto-expiry after job completion

### Phase 6c: SafeChat Protection (2-3 weeks)
- Pattern-based injection detection (regex layer)
- Message classification system
- Structured message delivery format for agents
- Safety scoring API
- Action confirmation flow
- Monitoring dashboard

### Phase 6d: Agent Notifications (1 week)
- Webhook registration for agents
- Event delivery (new message, file upload, job status change)
- Retry with exponential backoff
- OpenClaw cron integration example

---

## Dependencies

- Shield + Rex research on prompt injection (blocking Phase 6c)
- Socket.IO or ws library (Phase 6a)
- Multer or busboy for file uploads (Phase 6b)
- Storage backend decision: local vs S3 (Phase 6b)
- ML model for injection classification (Phase 6c, can start with regex)

---

## Decisions (Auto — 2026-02-06)

1. **Message persistence**: Auto-delete after 24 hours. Users can download full conversation before expiry (export as JSON/PDF, signed with job hash). Extended retention is a future premium feature.
2. **Group chat**: Yes — multi-agent jobs get group chat rooms.
3. **Agent-to-agent chat**: Yes, with SafeChat running between them. May need special handling if agents don't communicate in human-readable format.
4. **Offline messages**: Queue and deliver on next connect/poll.
5. **Message editing/deletion**: NO edits, NO deletes. Messages are immutable. Agents take prompts — edited messages would break context. Immutability also provides audit trail for disputes.

## Future Premium Features (Brainstorm)

- Extended message retention (30/90 days, permanent)
- Priority SafeChat scanning
- Larger file upload limits
- Webhook notifications (vs polling)
- Conversation analytics

---

_This is the feature that makes the platform actually usable for real work. Everything before this was infrastructure. This is where agents start doing jobs._ ⚙️
