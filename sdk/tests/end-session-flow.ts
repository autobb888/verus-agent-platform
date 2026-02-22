/**
 * End-to-End Test: End Session Flow
 *
 * Exercises the full end-session lifecycle:
 *   1. Seller requests end session (tokens_depleted)
 *   2. Seller delivers
 *   3. Buyer completes
 *   4. Buyer submits review
 *   5. Verify review in agent inbox
 *
 * Prerequisites:
 *   - A running platform instance (API_URL)
 *   - A job in `in_progress` state (pass JOB_ID as env var or first CLI arg)
 *   - Verus CLI available with wallets for buyer + seller unlocked
 *
 * Usage:
 *   BUYER_ID="buyer@" SELLER_ID="seller@" JOB_ID="<id>" API_URL="http://localhost:3000" \
 *     npx tsx sdk/tests/end-session-flow.ts
 */

import { VerusAgentClient, CliSigner } from '../src/index.js';

// ─── Config ───────────────────────────────────────────────────
const API_URL = process.env.API_URL || 'http://localhost:3000';
const BUYER_ID = process.env.BUYER_ID;
const SELLER_ID = process.env.SELLER_ID;
const JOB_ID = process.env.JOB_ID || process.argv[2];

if (!BUYER_ID || !SELLER_ID || !JOB_ID) {
  console.error('Missing required env vars: BUYER_ID, SELLER_ID, JOB_ID');
  console.error('Usage: BUYER_ID="buyer@" SELLER_ID="seller@" JOB_ID="123" npx tsx sdk/tests/end-session-flow.ts');
  process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────
const results: Array<{ step: string; ok: boolean; detail?: string }> = [];

function log(step: string, ok: boolean, detail?: string) {
  const icon = ok ? '✓' : '✗';
  console.log(`  ${icon} ${step}${detail ? ` — ${detail}` : ''}`);
  results.push({ step, ok, detail });
}

// ─── Clients ──────────────────────────────────────────────────
const sellerSigner = new CliSigner({ verusId: SELLER_ID, testnet: true });
const buyerSigner = new CliSigner({ verusId: BUYER_ID, testnet: true });

const sellerClient = new VerusAgentClient({ baseUrl: API_URL, signer: sellerSigner });
const buyerClient = new VerusAgentClient({ baseUrl: API_URL, signer: buyerSigner });

async function run() {
  console.log(`\n=== End-Session Flow Test ===`);
  console.log(`  API:    ${API_URL}`);
  console.log(`  Job:    ${JOB_ID}`);
  console.log(`  Buyer:  ${BUYER_ID}`);
  console.log(`  Seller: ${SELLER_ID}\n`);

  // ── Login both parties ──────────────────────────────────────
  try {
    await sellerClient.login();
    log('Seller login', true);
  } catch (e: any) {
    log('Seller login', false, e.message);
    return;
  }

  try {
    await buyerClient.login();
    log('Buyer login', true);
  } catch (e: any) {
    log('Buyer login', false, e.message);
    return;
  }

  // ── Verify job is in_progress ───────────────────────────────
  let jobHash: string;
  try {
    const { data: job } = await sellerClient.jobs.get(Number(JOB_ID)) as any;
    if (job.status !== 'in_progress') {
      log('Verify job status', false, `Expected in_progress, got ${job.status}`);
      return;
    }
    jobHash = job.jobHash;
    log('Verify job status', true, `in_progress, hash=${jobHash.slice(0, 8)}...`);
  } catch (e: any) {
    log('Verify job status', false, e.message);
    return;
  }

  // ── Step 1: Seller requests end session ─────────────────────
  try {
    const res = await sellerClient.jobs.requestEndSession(Number(JOB_ID), {
      reason: 'tokens_depleted',
    }) as any;
    log('Seller requestEndSession', true, `status=${res.data?.status}`);
  } catch (e: any) {
    log('Seller requestEndSession', false, e.message);
    return;
  }

  // ── Step 2: Seller delivers ─────────────────────────────────
  try {
    const ts = Math.floor(Date.now() / 1000);
    const deliveryHash = 'pending';
    const msg = `VAP-DELIVER|Job:${jobHash}|Delivery:${deliveryHash}|Ts:${ts}|I have delivered the work for this job.`;
    const sig = await sellerSigner.sign(msg);

    const res = await sellerClient.jobs.deliver(Number(JOB_ID), {
      timestamp: ts,
      signature: sig,
      deliverable: deliveryHash,
    }) as any;
    log('Seller deliver', true, `status=${res.data?.status}`);
  } catch (e: any) {
    log('Seller deliver', false, e.message);
    return;
  }

  // ── Step 3: Buyer completes ─────────────────────────────────
  try {
    const ts = Math.floor(Date.now() / 1000);
    const msg = `VAP-COMPLETE|Job:${jobHash}|Ts:${ts}|I confirm the work has been delivered satisfactorily.`;
    const sig = await buyerSigner.sign(msg);

    const res = await buyerClient.jobs.complete(Number(JOB_ID), {
      timestamp: ts,
      signature: sig,
    }) as any;
    log('Buyer complete', true, `status=${res.data?.status}`);
  } catch (e: any) {
    log('Buyer complete', false, e.message);
    return;
  }

  // ── Step 4: Buyer submits review ────────────────────────────
  try {
    const res = await buyerClient.reviews.submit({
      agentVerusId: SELLER_ID,
      jobHash,
      rating: 5,
      message: 'Great work — end-session flow test',
    }) as any;
    log('Buyer submit review', true, `inboxId=${res.data?.inboxId}`);
  } catch (e: any) {
    log('Buyer submit review', false, e.message);
    // Non-fatal — continue to check inbox
  }

  // ── Step 5: Verify review in seller inbox ───────────────────
  try {
    const { data: items } = await sellerClient.inbox.list() as any;
    const reviewItem = items?.find?.((i: any) =>
      i.type === 'review' && i.jobHash === jobHash
    );
    if (reviewItem) {
      log('Review in seller inbox', true, `rating=${reviewItem.rating}`);
    } else {
      log('Review in seller inbox', false, 'Review not found in inbox');
    }
  } catch (e: any) {
    log('Review in seller inbox', false, e.message);
  }

  // ── Summary ─────────────────────────────────────────────────
  console.log(`\n=== Results ===`);
  const passed = results.filter(r => r.ok).length;
  const total = results.length;
  console.log(`  ${passed}/${total} steps passed\n`);

  if (passed < total) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
