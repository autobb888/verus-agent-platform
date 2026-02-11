/**
 * Test Dashboard Auth Flow
 * 
 * 1. Request challenge
 * 2. Sign with wallet
 * 3. Login
 * 4. Check /auth/me
 * 5. Logout
 */

import { initDatabase } from '../src/db/index.js';
import { createServer } from '../src/api/server.js';
import { getRpcClient } from '../src/indexer/rpc-client.js';

async function test() {
  console.log('=== Dashboard Auth Test ===\n');
  
  initDatabase();
  const rpc = getRpcClient();
  
  const server = await createServer();
  await server.listen({ port: 3200, host: '127.0.0.1' });
  console.log('Server running on port 3200\n');
  
  const baseUrl = 'http://127.0.0.1:3200';
  
  // 1. Request challenge
  console.log('1. Requesting challenge...');
  const challengeRes = await fetch(`${baseUrl}/auth/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ verusId: 'ari@' }),
  });
  
  const challengeData = await challengeRes.json() as any;
  console.log('   Challenge received:', challengeData.data.message.split('\n')[0]);
  console.log('   Nonce:', challengeData.data.nonce);
  
  // 2. Sign the challenge
  console.log('\n2. Signing challenge with ari@ wallet...');
  const signature = await rpc.signMessage('ari@', challengeData.data.message);
  console.log('   Signature:', signature.slice(0, 30) + '...');
  
  // 3. Login
  console.log('\n3. Logging in...');
  const loginRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      verusId: 'ari@',
      nonce: challengeData.data.nonce,
      signature,
    }),
  });
  
  const loginData = await loginRes.json() as any;
  const setCookie = loginRes.headers.get('set-cookie');
  
  if (loginRes.status !== 200) {
    console.log('   ❌ Login failed:', loginData.error);
    await server.close();
    process.exit(1);
  }
  
  console.log('   ✅ Login successful!');
  console.log('   Identity:', loginData.data.identityAddress);
  console.log('   Expires:', loginData.data.expiresAt);
  console.log('   Cookie set:', setCookie ? 'Yes' : 'No');
  
  // Extract session cookie
  const sessionCookie = setCookie?.match(/session=([^;]+)/)?.[1];
  
  // 4. Check /auth/me
  console.log('\n4. Checking /auth/me...');
  const meRes = await fetch(`${baseUrl}/auth/me`, {
    headers: { 'Cookie': `session=${sessionCookie}` },
  });
  
  const meData = await meRes.json() as any;
  
  if (meRes.status !== 200) {
    console.log('   ❌ Failed:', meData.error);
  } else {
    console.log('   ✅ Authenticated as:', meData.data.verusId);
  }
  
  // 5. Logout
  console.log('\n5. Logging out...');
  const logoutRes = await fetch(`${baseUrl}/auth/logout`, {
    method: 'POST',
    headers: { 'Cookie': `session=${sessionCookie}` },
  });
  
  const logoutData = await logoutRes.json() as any;
  console.log('   ', logoutData.data.message);
  
  // 6. Verify logged out
  console.log('\n6. Verifying logout...');
  const meRes2 = await fetch(`${baseUrl}/auth/me`, {
    headers: { 'Cookie': `session=${sessionCookie}` },
  });
  
  if (meRes2.status === 401) {
    console.log('   ✅ Session properly invalidated');
  } else {
    console.log('   ❌ Session still valid (unexpected)');
  }
  
  await server.close();
  console.log('\n✅ AUTH TEST PASSED!');
  process.exit(0);
}

test().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
