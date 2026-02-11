/**
 * Integrated Verification Test
 * Runs mock endpoint and test in same process
 */

import Fastify from 'fastify';
import { initDatabase, getDatabase } from '../src/db/index.js';
import { v4 as uuidv4 } from 'uuid';
import {
  createVerification,
  sendChallenge,
  verifyChallenge,
  type VerificationJob,
} from '../src/worker/verification.js';

const challenges = new Map<string, { token: string; timestamp: number }>();

async function startMockServer() {
  const fastify = Fastify();
  
  fastify.post('/.well-known/verus-agent', async (request) => {
    const body = request.body as any;
    if (body.action === 'challenge' && body.token && body.verusId) {
      challenges.set(body.verusId, { token: body.token, timestamp: body.timestamp });
      return { status: 'ok' };
    }
    return { error: 'Invalid' };
  });
  
  fastify.get('/.well-known/verus-agent', async () => {
    const entries = Array.from(challenges.entries());
    if (entries.length === 0) return { error: 'No challenge' };
    const [verusId, challenge] = entries[entries.length - 1];
    return { verusId, token: challenge.token, timestamp: challenge.timestamp };
  });
  
  await fastify.listen({ port: 3100, host: '127.0.0.1' });
  console.log('[Mock] Server running on http://127.0.0.1:3100');
  return fastify;
}

async function runTest() {
  console.log('=== Integrated Verification Test ===\n');
  
  // Start mock server
  const server = await startMockServer();
  
  // Initialize database
  initDatabase();
  const db = getDatabase();
  
  // Create test agent
  const agentId = uuidv4();
  const verusId = `iTest${Date.now()}`;
  
  console.log('1. Creating test agent:', verusId);
  db.prepare(`
    INSERT INTO agents (id, verus_id, name, type, description, owner, status, block_height, block_hash, created_at, updated_at)
    VALUES (?, ?, 'Test Agent', 'assisted', 'Test', ?, 'active', 0, 'test', datetime('now'), datetime('now'))
  `).run(agentId, verusId, verusId);
  
  // Create endpoint
  const endpointId = uuidv4();
  console.log('2. Creating endpoint');
  db.prepare(`
    INSERT INTO agent_endpoints (id, agent_id, url, protocol, public)
    VALUES (?, ?, 'http://127.0.0.1:3100', 'REST', 1)
  `).run(endpointId, agentId);
  
  // Create verification
  console.log('3. Creating verification');
  const verificationId = createVerification(endpointId, agentId, 'http://127.0.0.1:3100');
  
  const verification = db.prepare('SELECT * FROM endpoint_verifications WHERE id = ?').get(verificationId) as any;
  console.log('   Challenge token:', verification.challenge_token.slice(0, 16) + '...');
  
  const job: VerificationJob = {
    verificationId,
    endpointId,
    agentId,
    url: 'http://127.0.0.1:3100',
    verusId: 'test@',
  };
  
  // Send challenge
  console.log('\n4. Sending challenge...');
  const sendResult = await sendChallenge(job);
  console.log('   Send result:', sendResult.success ? '✅ Success' : `❌ ${sendResult.error}`);
  
  if (!sendResult.success) {
    await server.close();
    db.prepare('DELETE FROM agents WHERE id = ?').run(agentId);
    process.exit(1);
  }
  
  // Verify
  console.log('\n5. Verifying...');
  const verifyResult = await verifyChallenge(job);
  console.log('   Verify result:', verifyResult.success ? '✅ Success' : `❌ ${verifyResult.error}`);
  
  // Check status
  const final = db.prepare('SELECT * FROM endpoint_verifications WHERE id = ?').get(verificationId) as any;
  console.log('\n=== Final Status ===');
  console.log('Status:', final.status);
  console.log('Verified:', final.status === 'verified' ? '✅ YES' : '❌ NO');
  
  // Cleanup
  db.prepare('DELETE FROM agents WHERE id = ?').run(agentId);
  await server.close();
  
  console.log(final.status === 'verified' ? '\n✅ TEST PASSED!' : '\n❌ TEST FAILED');
  process.exit(final.status === 'verified' ? 0 : 1);
}

runTest().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
