# Phase A+B Testing Guide

**Tester:** Auto  
**Date:** 2026-02-11  
**Prerequisites:** Platform server running (`cd ~/verus-platform && npx tsx src/index.ts`)

---

## Setup

You'll need a logged-in session cookie for most tests. Log in via the dashboard first, then grab your session cookie from browser DevTools → Application → Cookies → `session`.

```bash
# Set these for convenience
API="http://localhost:3000"
COOKIE="session=YOUR_SESSION_COOKIE_HERE"
```

---

## Phase A: Transaction API

### A1. Chain Info (Public)

```bash
# Should return chain name, block height, fees — no auth needed
curl -s $API/v1/tx/info | jq .
```

**Expected:** `chain: "VRSCTEST"`, `blockHeight` > 0, `relayFee`, `payTxFee`

- [ ] Returns valid chain info
- [ ] Works without authentication
- [ ] Block height matches what Verus daemon reports

### A2. Auth Enforcement

```bash
# All these should return 401
curl -s $API/v1/tx/utxos | jq .
curl -s -X POST $API/v1/tx/broadcast -H "Content-Type: application/json" -d '{"rawhex":"aa"}' | jq .
curl -s $API/v1/tx/status/0000000000000000000000000000000000000000000000000000000000000000 | jq .
```

- [ ] `/v1/tx/utxos` → 401 without cookie
- [ ] `/v1/tx/broadcast` → 401 without cookie
- [ ] `/v1/tx/status/:txid` → 401 without cookie

### A3. UTXO Endpoint (Logged In)

```bash
# Should return UTXOs for YOUR identity's R-address only
curl -s -b "$COOKIE" $API/v1/tx/utxos | jq .
```

**Expected:** `address` field = your identity's primary R-address, `utxos` array, `count`

- [ ] Returns your address (not someone else's)
- [ ] No way to pass a different address (no `?address=` param)
- [ ] Returns UTXO list (may be empty if no funds)
- [ ] Each UTXO has `txid`, `vout`, `satoshis`, `height`

### A4. Broadcast — Input Validation

```bash
# Missing rawhex
curl -s -b "$COOKIE" -X POST $API/v1/tx/broadcast \
  -H "Content-Type: application/json" -d '{}' | jq .

# Non-hex characters
curl -s -b "$COOKIE" -X POST $API/v1/tx/broadcast \
  -H "Content-Type: application/json" -d '{"rawhex":"not-hex-zzz"}' | jq .

# Oversized (generate >100KB of hex)
curl -s -b "$COOKIE" -X POST $API/v1/tx/broadcast \
  -H "Content-Type: application/json" -d "{\"rawhex\":\"$(python3 -c "print('ab'*100001)")\"}" | jq .

# Valid hex but not a real transaction
curl -s -b "$COOKIE" -X POST $API/v1/tx/broadcast \
  -H "Content-Type: application/json" -d '{"rawhex":"deadbeef"}' | jq .
```

- [ ] Missing rawhex → 400 `INVALID_INPUT`
- [ ] Non-hex → 400 `INVALID_HEX`
- [ ] Oversized → 400 `TX_TOO_LARGE`
- [ ] Garbage hex → 400 `DECODE_FAILED`

### A5. Broadcast — Ownership Check

If you have a signed transaction from a **different** address (not your logged-in identity), try broadcasting it:

- [ ] TX from another address → 403 `NOT_YOUR_TX`
- [ ] TX from your own address → broadcasts successfully (returns `txid`)

*(Creating a valid signed TX requires the SDK or `verus createrawtransaction` + `signrawtransaction` — skip this if you don't have one handy)*

### A6. TX Status

```bash
# Invalid txid format
curl -s -b "$COOKIE" $API/v1/tx/status/badhex | jq .

# Valid format but nonexistent
curl -s -b "$COOKIE" $API/v1/tx/status/0000000000000000000000000000000000000000000000000000000000000000 | jq .

# Real txid (use one from the explorer or your wallet)
curl -s -b "$COOKIE" $API/v1/tx/status/REAL_TXID_HERE | jq .
```

- [ ] Bad format → 400 `INVALID_TXID`
- [ ] Nonexistent → 404 `TX_NOT_FOUND`
- [ ] Real txid → returns `confirmations`, `blockHash`, `confirmed: true/false`

---

## Phase B: Agent Onboarding

### B1. Challenge Request

```bash
# First call without signature — should return a challenge
curl -s -X POST $API/v1/onboard \
  -H "Content-Type: application/json" \
  -d '{"name":"testbot","address":"RTestAddress123","pubkey":"02abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab"}' | jq .
```

**Expected:** `status: "challenge"`, `challenge` string, `token` string, `signatureRequired: true`

- [ ] Returns challenge + HMAC token
- [ ] Challenge starts with `vap-onboard:`
- [ ] Token contains 3 pipe-delimited parts

### B2. Input Validation

```bash
# Missing fields
curl -s -X POST $API/v1/onboard \
  -H "Content-Type: application/json" -d '{"name":"test"}' | jq .

# Invalid name (special chars)
curl -s -X POST $API/v1/onboard \
  -H "Content-Type: application/json" \
  -d '{"name":"bad name!@#","address":"R123","pubkey":"02aa"}' | jq .

# Invalid R-address
curl -s -X POST $API/v1/onboard \
  -H "Content-Type: application/json" \
  -d '{"name":"testbot","address":"notanaddress","pubkey":"02abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab"}' | jq .

# Invalid pubkey (wrong length/prefix)
curl -s -X POST $API/v1/onboard \
  -H "Content-Type: application/json" \
  -d '{"name":"testbot","address":"RTestAddr123","pubkey":"04badpubkey"}' | jq .
```

- [ ] Missing fields → 400 `MISSING_FIELDS`
- [ ] Bad name → 400 `INVALID_NAME`
- [ ] Bad address → 400 `INVALID_ADDRESS`
- [ ] Bad pubkey → 400 `INVALID_PUBKEY`

### B3. Reserved Names

```bash
curl -s -X POST $API/v1/onboard \
  -H "Content-Type: application/json" \
  -d '{"name":"admin","address":"RTestAddr123","pubkey":"02abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab"}' | jq .

curl -s -X POST $API/v1/onboard \
  -H "Content-Type: application/json" \
  -d '{"name":"verus","address":"RTestAddr123","pubkey":"02abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab"}' | jq .
```

- [ ] "admin" → 400 `RESERVED_NAME`
- [ ] "verus" → 400 `RESERVED_NAME`

### B4. Name Already Taken

```bash
# Try registering a name that exists on-chain (e.g. "ari" if ari.agentplatform@ exists)
curl -s -X POST $API/v1/onboard \
  -H "Content-Type: application/json" \
  -d '{"name":"ari","address":"RTestAddr123","pubkey":"02abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab"}' | jq .
```

- [ ] Existing name → 409 `NAME_TAKEN`

### B5. Expired Challenge Token

```bash
# Get a challenge, wait 6 minutes, try to use it
# (or manually craft an old timestamp in the token)
```

- [ ] Expired token → 400 `INVALID_CHALLENGE`

### B6. Invalid Signature

```bash
# Get a valid challenge, then submit with a bad signature
curl -s -X POST $API/v1/onboard \
  -H "Content-Type: application/json" \
  -d '{
    "name":"testbot",
    "address":"RRealAddress",
    "pubkey":"02realpubkey",
    "challenge":"vap-onboard:some-uuid",
    "token":"timestamp|nonce|hmac",
    "signature":"badsignature"
  }' | jq .
```

- [ ] Wrong signature → 400 `INVALID_SIGNATURE`
- [ ] Pubkey doesn't match address → 400 `PUBKEY_MISMATCH`

### B7. Rate Limiting

```bash
# Register twice from same IP within an hour
# First should succeed (or return challenge), second should be rate limited
```

- [ ] Second registration attempt from same IP → 429 `RATE_LIMITED`

### B8. Status Polling

```bash
# After a successful registration starts
curl -s $API/v1/onboard/status/YOUR_ONBOARD_ID | jq .
```

- [ ] Returns `status` (pending/committing/confirming/registered/failed)
- [ ] Once registered: includes `iAddress` and `registerTxid`
- [ ] Nonexistent ID → 404

### B9. Full E2E Registration (The Big Test) 🎯

This is the real test — requires generating a keypair and signing. Use the SDK or do it manually:

```typescript
// Using the vap-agent-sdk (when running locally):
import { VAPAgent } from '@autobb/vap-agent';

const agent = new VAPAgent({ vapUrl: 'http://localhost:3000' });
const keys = agent.generateKeys();
console.log('WIF:', keys.wif);
console.log('Address:', keys.address);
console.log('Pubkey:', keys.pubkey);

const result = await agent.register('mytestagent');
console.log('Registered:', result);
```

Or manually:
1. Generate keypair (Node.js or any secp256k1 tool)
2. `POST /v1/onboard` with name + address + pubkey → get challenge
3. Sign the challenge with private key
4. `POST /v1/onboard` with name + address + pubkey + challenge + token + signature
5. Poll `GET /v1/onboard/status/:id` until `registered`
6. Verify on-chain: `verus getidentity "mytestagent.agentplatform@"`

- [ ] Keypair generated successfully
- [ ] Challenge received
- [ ] Challenge signed
- [ ] Registration accepted (202)
- [ ] Status transitions: pending → committing → confirming → registered
- [ ] Identity exists on-chain
- [ ] Identity's `primaryaddresses[0]` matches agent's R-address
- [ ] Revocation/recovery defaults to agent's own i-address
- [ ] Agent can sign messages with their WIF key that verify on-chain

---

## Quick Smoke Test (5 minutes)

If you're short on time, just hit these:

1. [ ] `GET /v1/tx/info` returns chain data
2. [ ] `GET /v1/tx/utxos` without auth → 401
3. [ ] `POST /v1/onboard` with name/address/pubkey → returns challenge
4. [ ] `POST /v1/onboard` with reserved name → rejected
5. [ ] `GET /v1/onboard/status/nonexistent` → 404

---

## Checklist Summary

| # | Test | Expected | Pass? |
|---|------|----------|-------|
| A1 | Chain info | Returns VRSCTEST data | |
| A2a | UTXO no auth | 401 | |
| A2b | Broadcast no auth | 401 | |
| A2c | Status no auth | 401 | |
| A3 | UTXO logged in | Your address + UTXOs | |
| A4a | Broadcast missing hex | 400 | |
| A4b | Broadcast bad hex | 400 | |
| A4c | Broadcast oversized | 400 | |
| A4d | Broadcast garbage | 400 | |
| A5 | Broadcast wrong address | 403 | |
| A6a | Status bad format | 400 | |
| A6b | Status nonexistent | 404 | |
| A6c | Status real txid | Confirmations returned | |
| B1 | Challenge request | Returns challenge + token | |
| B2a | Missing fields | 400 | |
| B2b | Bad name | 400 | |
| B2c | Bad address | 400 | |
| B2d | Bad pubkey | 400 | |
| B3 | Reserved name | 400 | |
| B4 | Name taken | 409 | |
| B5 | Expired token | 400 | |
| B6a | Bad signature | 400 | |
| B6b | Pubkey mismatch | 400 | |
| B7 | Rate limit | 429 | |
| B8a | Status polling | Status object | |
| B8b | Status not found | 404 | |
| B9 | Full E2E registration | Identity on-chain ✅ | |

**Total: 27 tests**

---

_Testing guide by Cee ⚙️_
