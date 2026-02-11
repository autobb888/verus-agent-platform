/**
 * Full Reputation Calculator Test with sample data
 */

import { randomUUID } from 'crypto';
import { initDatabase, getDatabase } from '../src/db/index.js';

async function main() {
  console.log('=== Full Reputation Calculator Test ===\n');

  initDatabase();
  const db = getDatabase();

  // Get our test agent
  const agent = db.prepare('SELECT * FROM agents LIMIT 1').get() as any;
  if (!agent) {
    console.log('❌ No agents found');
    process.exit(1);
  }
  console.log(`Testing with agent: ${agent.name} (${agent.verus_id})\n`);

  // Insert test reviews
  const testReviews = [
    { rating: 5, buyer: 'iBuyer1TestAddress', days_ago: 5, message: 'Excellent work!' },
    { rating: 4, buyer: 'iBuyer2TestAddress', days_ago: 15, message: 'Good service' },
    { rating: 5, buyer: 'iBuyer3TestAddress', days_ago: 30, message: 'Fast delivery' },
    { rating: 3, buyer: 'iBuyer4TestAddress', days_ago: 60, message: 'Average' },
    { rating: 5, buyer: 'iBuyer5TestAddress', days_ago: 90, message: 'Great!' },
    { rating: 4, buyer: 'iBuyer1TestAddress', days_ago: 100, message: 'Second purchase, still good' }, // Same buyer
  ];

  const insertedIds: string[] = [];
  const now = Math.floor(Date.now() / 1000);

  console.log('Inserting test reviews...');
  for (const review of testReviews) {
    const id = randomUUID();
    insertedIds.push(id);
    const timestamp = now - (review.days_ago * 24 * 60 * 60);
    
    db.prepare(`
      INSERT INTO reviews (id, agent_id, agent_verus_id, buyer_verus_id, job_hash, message, rating, signature, review_timestamp, verified, block_height)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      agent.id,
      agent.verus_id,
      review.buyer,
      `job_test_${id.slice(0, 8)}`,
      review.message,
      review.rating,
      'test_signature',
      timestamp,
      1, // verified
      900000
    );
  }
  console.log(`✅ Inserted ${testReviews.length} test reviews\n`);

  // Now test the calculator
  const { getReputationCalculator } = await import('../src/reputation/calculator.js');
  const calculator = getReputationCalculator();

  console.log('Calculating reputation...\n');
  const result = await calculator.calculate(agent.verus_id);

  console.log('=== RESULTS ===\n');
  console.log(`Score (weighted):    ${result.score?.toFixed(2) || 'N/A'}`);
  console.log(`Raw Average:         ${result.rawAverage?.toFixed(2) || 'N/A'}`);
  console.log(`Total Reviews:       ${result.totalReviews}`);
  console.log(`Verified Reviews:    ${result.verifiedReviews}`);
  console.log(`Unique Reviewers:    ${result.uniqueReviewers}`);
  console.log(`Reviewer Diversity:  ${(result.reviewerDiversity * 100).toFixed(0)}%`);
  console.log(`Confidence:          ${result.confidence}`);
  console.log(`Trending:            ${result.trending}`);
  console.log(`Recent (30d):        ${result.recentReviews}`);
  
  console.log('\n--- Transparency ---');
  console.log(`Note: ${result.transparency.note}`);
  console.log('Distribution:');
  for (const d of result.transparency.reviewDistribution) {
    const bar = '★'.repeat(d.count);
    console.log(`  ${d.rating}⭐: ${bar} (${d.count})`);
  }

  if (result.sybilFlags.length > 0) {
    console.log('\n--- Sybil Flags ---');
    for (const flag of result.sybilFlags) {
      console.log(`⚠️ [${flag.severity}] ${flag.type}: ${flag.description}`);
    }
  } else {
    console.log('\n✅ No Sybil flags detected');
  }

  // Cleanup
  console.log('\n--- Cleanup ---');
  for (const id of insertedIds) {
    db.prepare('DELETE FROM reviews WHERE id = ?').run(id);
  }
  console.log(`Removed ${insertedIds.length} test reviews`);

  console.log('\n=== Test Complete ===');
}

main().catch(console.error);
