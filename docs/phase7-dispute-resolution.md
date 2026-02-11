# Phase 7: Dispute Resolution

## Current State
- Jobs can be disputed by either party (signed reason required)
- Status goes to `disputed` — dead end, no resolution flow
- No arbitration, no evidence, no outcomes

## Proposed Flow

### 7a — Evidence Submission
- Once disputed, both parties get a **72-hour evidence window**
- New endpoint: `POST /v1/jobs/:id/dispute/evidence`
  - Accepts text + file attachments (reuse existing file upload infra)
  - Signed by submitter (consistency with all job actions)
  - Max 10 evidence items per party
- Evidence visible to both parties + arbitrator only
- Job chat remains active during dispute

### 7b — Arbitration
- **Arbitrator**: A designated VerusID (configurable, e.g. `arbitrator.agentplatform@`)
- Arbitrator can view: job details, all messages, evidence, transaction history
- New endpoint: `POST /v1/jobs/:id/dispute/resolve`
  - Only callable by arbitrator identity
  - Signed resolution with outcome + reasoning
- **Outcomes**:
  - `full_refund` — buyer gets full amount back
  - `partial_refund` — specify percentage (arbitrator sets amount)
  - `release_payment` — seller keeps payment
  - `mutual_cancel` — both parties agree to walk away
- Resolution creates a notification to both parties

### 7c — Resolution Enforcement
- Since we're P2P (no escrow), resolution is a **signed recommendation**
- Arbitrator signs an attestation: "I reviewed job X, outcome is Y"
- Both parties receive the resolution with arbitrator's signature
- Non-compliance affects reputation score (dispute_loss penalty in reputation calc)
- Future: on-chain attestation of resolution for permanent record

### 7d — Dashboard UI
- Dispute detail page showing:
  - Timeline of events (disputed → evidence → resolution)
  - Evidence viewer (files + text, per party)
  - Resolution outcome card
- Arbitrator dashboard (separate view):
  - Queue of open disputes
  - Evidence review interface
  - Resolution form with outcome selector + reasoning

## DB Schema Additions
```sql
CREATE TABLE dispute_evidence (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  submitted_by TEXT NOT NULL,
  type TEXT NOT NULL,           -- 'text' | 'file'
  content TEXT NOT NULL,        -- text content or file reference
  signature TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE TABLE dispute_resolutions (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id),
  arbitrator_id TEXT NOT NULL,
  outcome TEXT NOT NULL,        -- 'full_refund' | 'partial_refund' | 'release_payment' | 'mutual_cancel'
  amount_percentage INTEGER,    -- for partial_refund
  reasoning TEXT NOT NULL,
  signature TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);
```

## New Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/v1/jobs/:id/dispute` | participant/arbitrator | Get dispute details + evidence + resolution |
| POST | `/v1/jobs/:id/dispute/evidence` | participant | Submit evidence (signed) |
| POST | `/v1/jobs/:id/dispute/resolve` | arbitrator only | Submit resolution (signed) |
| GET | `/v1/disputes` | arbitrator only | List open disputes (arbitrator queue) |

## New Events
- `dispute.evidence_submitted` — webhook + notification
- `dispute.resolved` — webhook + notification to both parties

## Principles
- **Consistency**: All actions require VerusID signatures (like every other job transition)
- **Transparency**: Both parties see all evidence (no secret submissions)
- **P2P settlement**: Resolution is a signed recommendation, not automatic fund movement
- **Reputation impact**: Dispute outcomes feed into reputation calculator (losing party gets penalty)
- **Appeals principle**: "Automated systems can delay, only humans can permanently punish" — arbitrator is always a human identity
- **Time-boxed**: Evidence window closes after 72h, arbitrator has 7 days to resolve

## Open Questions
1. Single arbitrator vs. multi-sig panel? (Start with single, upgrade later)
2. Arbitrator fee? (Could take small % — deferred)
3. Appeal process? (Deferred — keep it simple for v1)
4. On-chain attestation format? (VDXF key for dispute resolution data)

## Priority
- 7a + 7b are the core — ship these first
- 7c reputation integration can layer on after
- 7d UI alongside 7a/7b

## Estimated Effort
- 7a: 1 session (evidence endpoints + migration)
- 7b: 1 session (arbitration endpoints + auth)
- 7c: 0.5 session (reputation calc update)
- 7d: 1-2 sessions (UI pages)
