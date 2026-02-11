/**
 * Test Verification Worker
 * 
 * 1. Create a test agent with endpoint
 * 2. Create verification record
 * 3. Send challenge
 * 4. Verify response
 */

import { initDatabase, getDatabase } from '../src/db/index.js';
import { v4 as uuidv4 } from 'uuid';
import {
  createVerification,
  sendChallenge,
  verifyChallenge,
  type VerificationJob,
} from '../src/worker/verification.js';

const MOCK_ENDPOINT = 'http://localhost:3100';

async function test() {
  console.log('=== Verification Worker Test ===\n');
  
  // Initialize database
  initDatabase();
  const db = getDatabase();
  
  // 1. Create test agent (use unique verusId for testing)
  const agentId = uuidv4();
  const verusId = `iTest${Date.now()}`; // Unique test ID
  
  console.log('1. Creating test agent...');
  db.prepare(`
    INSERT INTO agents (id, verus_id, name, type, description, owner, status, block_height, block_hash, created_at, updated_at)
    VALUES (?, ?, 'Test Agent', 'assisted', 'Test agent for verification', ?, 'active', 0, 'test', datetime('now'), datetime('now'))
  `).run(agentId, verusId, verusId);
  console.log('   Agent created:', agentId);
  
  // 2. Create test endpoint
  const endpointId = uuidv4();
  console.log('\n2. Creating test endpoint...');
  db.prepare(`
    INSERT INTO agent_endpoints (id, agent_id, url, protocol, public)
    VALUES (?, ?, ?, 'REST', 1)
  `).run(endpointId, agentId, MOCK_ENDPOINT);
  console.log('   Endpoint created:', endpointId);
  console.log('   URL:', MOCK_ENDPOINT);
  
  // 3. Create verification record
  console.log('\n3. Creating verification record...');
  const verificationId = createVerification(endpointId, agentId, MOCK_ENDPOINT);
  console.log('   Verification created:', verificationId);
  
  // Get the verification record
  const verification = db.prepare('SELECT * FROM endpoint_verifications WHERE id = ?').get(verificationId) as any;
  console.log('   Challenge token:', verification.challenge_token);
  
  // 4. Create job object
  const job: VerificationJob = {
    verificationId,
    endpointId,
    agentId,
    url: MOCK_ENDPOINT,
    verusId: 'ari@',
  };
  
  // 5. Send challenge
  console.log('\n4. Sending challenge to mock endpoint...');
  const sendResult = await sendChallenge(job);
  console.log('   Result:', sendResult);
  
  if (!sendResult.success) {
    console.log('\n❌ Challenge send failed:', sendResult.error);
    console.log('\nMake sure mock endpoint is running:');
    console.log('   npx tsx test/mock-endpoint.ts');
    process.exit(1);
  }
  
  // 6. Verify (normally would wait 5 min, but for testing do immediately)
  console.log('\n5. Verifying challenge response...');
  const verifyResult = await verifyChallenge(job);
  console.log('   Result:', verifyResult);
  
  // 7. Check final status
  const finalVerification = db.prepare('SELECT * FROM endpoint_verifications WHERE id = ?').get(verificationId) as any;
  const finalEndpoint = db.prepare('SELECT * FROM agent_endpoints WHERE id = ?').get(endpointId) as any;
  
  console.log('\n=== Final Status ===');
  console.log('Verification status:', finalVerification.status);
  console.log('Endpoint verified:', finalEndpoint.verified ? 'Yes' : 'No');
  console.log('Verified at:', finalVerification.verified_at);
  console.log('Next verification:', finalVerification.next_verification_at);
  
  if (finalVerification.status === 'verified') {
    console.log('\n✅ Verification worker test PASSED!');
  } else {
    console.log('\n❌ Verification failed:', finalVerification.error_message);
  }
  
  // Cleanup
  db.prepare('DELETE FROM agents WHERE id = ?').run(agentId);
  
  process.exit(0);
}

test().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
