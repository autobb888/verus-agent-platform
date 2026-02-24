/**
 * Test A2A Job Flow
 * Simulates: Request → Accept → Deliver → Complete
 */

import { initDatabase, getDatabase, jobQueries, inboxQueries, agentQueries } from '../src/db/index.js';
import { createHash, randomUUID } from 'crypto';

async function main() {
  console.log('=== A2A Job Flow Test ===\n');

  initDatabase();
  const db = getDatabase();

  // Get our test agent (seller)
  const agent = db.prepare('SELECT * FROM agents LIMIT 1').get() as any;
  if (!agent) {
    console.log('❌ No agents found. Register an agent first.');
    process.exit(1);
  }

  const sellerVerusId = agent.verus_id;
  const buyerVerusId = 'iBuyerTestAgent123456789';
  
  console.log(`Seller: ${agent.name} (${sellerVerusId})`);
  console.log(`Buyer: ${buyerVerusId}\n`);

  // 1. Create job request
  console.log('1. Creating job request...');
  const timestamp = Math.floor(Date.now() / 1000);
  const description = 'Build a smart contract for token vesting';
  const amount = 50;
  const currency = 'VRSCTEST';
  
  const jobHash = createHash('sha256')
    .update(`${buyerVerusId}:${sellerVerusId}:${description}:${amount}:${timestamp}`)
    .digest('hex')
    .slice(0, 32);

  const jobId = jobQueries.insert({
    job_hash: jobHash,
    buyer_verus_id: buyerVerusId,
    seller_verus_id: sellerVerusId,
    service_id: null,
    description,
    amount,
    currency,
    deadline: null,
    request_signature: 'AVTestRequestSignature123',
    acceptance_signature: null,
    delivery_signature: null,
    completion_signature: null,
    status: 'requested',
    delivery_hash: null,
    delivery_message: null,
    requested_at: new Date().toISOString(),
    accepted_at: null,
    delivered_at: null,
    completed_at: null,
  });

  console.log(`   ✅ Job created: ${jobId}`);
  console.log(`   Hash: ${jobHash}`);
  console.log(`   Status: requested\n`);

  // Check seller's inbox
  const inboxItems = inboxQueries.getByRecipient(sellerVerusId, 'pending');
  console.log(`   Seller inbox: ${inboxItems.length} pending items\n`);

  // 2. Seller accepts
  console.log('2. Seller accepts job...');
  jobQueries.setAccepted(jobId, 'AVTestAcceptanceSignature456', sellerVerusId);
  
  let job = jobQueries.getById(jobId)!;
  console.log(`   ✅ Status: ${job.status}`);
  console.log(`   Acceptance signature: ${job.acceptance_signature?.slice(0, 20)}...\n`);

  // 3. Seller delivers
  console.log('3. Seller delivers work...');
  const deliveryHash = 'ipfs://QmTestDeliveryHash123456789';
  jobQueries.setDelivered(jobId, 'AVTestDeliverySignature789', deliveryHash, 'Here is the completed contract!', sellerVerusId);
  
  job = jobQueries.getById(jobId)!;
  console.log(`   ✅ Status: ${job.status}`);
  console.log(`   Delivery hash: ${job.delivery_hash}`);
  console.log(`   Delivery signature: ${job.delivery_signature?.slice(0, 20)}...\n`);

  // 4. Buyer confirms completion
  console.log('4. Buyer confirms completion...');
  jobQueries.setCompleted(jobId, 'AVTestCompletionSignature101', buyerVerusId);
  
  job = jobQueries.getById(jobId)!;
  console.log(`   ✅ Status: ${job.status}`);
  console.log(`   Completion signature: ${job.completion_signature?.slice(0, 20)}...\n`);

  // 5. Show final job state
  console.log('=== Final Job State ===');
  console.log(JSON.stringify({
    id: job.id,
    jobHash: job.job_hash,
    buyer: job.buyer_verus_id,
    seller: job.seller_verus_id,
    amount: `${job.amount} ${job.currency}`,
    status: job.status,
    signatures: {
      request: '✅',
      acceptance: '✅',
      delivery: '✅',
      completion: '✅',
    },
    timestamps: {
      requested: job.requested_at,
      accepted: job.accepted_at,
      delivered: job.delivered_at,
      completed: job.completed_at,
    },
  }, null, 2));

  // 6. Cleanup
  console.log('\n--- Cleanup ---');
  db.prepare('DELETE FROM jobs WHERE id = ?').run(jobId);
  console.log('✅ Test job removed');

  console.log('\n=== Test Complete ===');
}

main().catch(console.error);
