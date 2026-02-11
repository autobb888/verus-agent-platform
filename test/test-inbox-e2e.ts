/**
 * End-to-end inbox flow test
 * Tests the full cycle: submit review → inbox → updateidentity command
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

const DB_PATH = process.env.DB_PATH || './data/verus-platform.db';

async function main() {
  console.log('=== E2E Inbox Flow Test ===\n');

  // Connect to DB directly for testing
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  // 1. Get an agent
  const agent = db.prepare('SELECT * FROM agents LIMIT 1').get() as any;
  if (!agent) {
    console.log('❌ No agents in database. Register an agent first.');
    process.exit(1);
  }
  console.log(`1. Found agent: ${agent.name} (${agent.verus_id})`);

  // 2. Insert a test review into inbox
  const testReview = {
    id: randomUUID(),
    recipient_verus_id: agent.verus_id,
    type: 'review',
    sender_verus_id: 'iTestBuyerAddress123456789012345678',
    job_hash: `job_test_${Date.now()}`,
    rating: 5,
    message: 'Excellent service! Fast and professional. Would use again.',
    signature: 'AVTestSignature123456789',
    status: 'pending',
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    vdxf_data: JSON.stringify({
      'iD7jxJgc3kkAujGyTYFevWVES93ockGTL6': 'iTestBuyerAddress123456789012345678',
      'i43saPSm8hhi49bVBWaHbPFjR7qxiTLSBK': `job_test_${Date.now()}`,
      'i4jhY3wcaL4Q7hLoqLmDhfFA1iUKDUmcfZ': 'Excellent service!',
      'iQpxB7MZxGhwJmPYrLifwYA3MT82DkLjXT': '5',
    }),
  };

  console.log(`\n2. Inserting test review to inbox...`);
  console.log(`   Job: ${testReview.job_hash}`);
  console.log(`   Rating: ${testReview.rating}/5`);
  console.log(`   Message: "${testReview.message}"`);

  db.prepare(`
    INSERT INTO inbox (id, recipient_verus_id, type, sender_verus_id, job_hash, rating, message, signature, status, expires_at, vdxf_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    testReview.id,
    testReview.recipient_verus_id,
    testReview.type,
    testReview.sender_verus_id,
    testReview.job_hash,
    testReview.rating,
    testReview.message,
    testReview.signature,
    testReview.status,
    testReview.expires_at,
    testReview.vdxf_data
  );
  console.log(`   ✅ Inserted with ID: ${testReview.id}`);

  // 3. Query inbox
  console.log(`\n3. Querying inbox for ${agent.verus_id}...`);
  const inboxItems = db.prepare(`
    SELECT * FROM inbox WHERE recipient_verus_id = ? AND status = 'pending'
  `).all(agent.verus_id) as any[];

  console.log(`   Found ${inboxItems.length} pending items:`);
  for (const item of inboxItems) {
    console.log(`   - [${item.type}] from ${item.sender_verus_id.slice(0, 20)}... rating: ${item.rating}/5`);
  }

  // 4. Get our test item back
  const retrieved = db.prepare('SELECT * FROM inbox WHERE id = ?').get(testReview.id) as any;
  console.log(`\n4. Retrieved test item:`);
  console.log(`   ID: ${retrieved.id}`);
  console.log(`   Type: ${retrieved.type}`);
  console.log(`   Status: ${retrieved.status}`);
  console.log(`   Expires: ${retrieved.expires_at}`);

  // 5. Generate updateidentity command
  console.log(`\n5. Generating updateidentity command...`);
  const vdxfData = JSON.parse(retrieved.vdxf_data);
  const updateCmd = {
    name: agent.name,
    contentmultimap: vdxfData,
  };
  console.log(`\n   verus -testnet updateidentity '${JSON.stringify(updateCmd)}'`);

  // 6. Simulate accepting (status update)
  console.log(`\n6. Simulating agent accepting the review...`);
  db.prepare(`UPDATE inbox SET status = 'accepted', processed_at = datetime('now') WHERE id = ?`).run(testReview.id);
  const accepted = db.prepare('SELECT status, processed_at FROM inbox WHERE id = ?').get(testReview.id) as any;
  console.log(`   ✅ Status: ${accepted.status}, Processed: ${accepted.processed_at}`);

  // 7. Check pending count
  const pendingCount = db.prepare(`
    SELECT COUNT(*) as count FROM inbox WHERE recipient_verus_id = ? AND status = 'pending'
  `).get(agent.verus_id) as { count: number };
  console.log(`\n7. Remaining pending items: ${pendingCount.count}`);

  // Cleanup - remove test item
  db.prepare('DELETE FROM inbox WHERE id = ?').run(testReview.id);
  console.log(`\n8. ✅ Cleaned up test data`);

  db.close();
  console.log('\n=== Test Complete ===');
}

main().catch(console.error);
