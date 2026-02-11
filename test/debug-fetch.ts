import { ssrfSafeFetch } from '../src/utils/ssrf-fetch.js';

async function test() {
  console.log('Testing ssrfSafeFetch on localhost:3100...');
  console.log('Env SSRF_ALLOW_TEST_PORTS:', process.env.SSRF_ALLOW_TEST_PORTS);
  console.log('Env SSRF_ALLOW_LOCALHOST:', process.env.SSRF_ALLOW_LOCALHOST);
  
  const result = await ssrfSafeFetch('http://localhost:3100/health', { 
    method: 'GET',
    allowHttp: true,
  });
  
  console.log('Result:', JSON.stringify(result, null, 2));
}

test().catch(err => {
  console.error('Error:', err.message);
});
