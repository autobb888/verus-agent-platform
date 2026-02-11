import { resolve4 } from 'dns/promises';

async function test() {
  const url = 'http://localhost:3100/health';
  const parsed = new URL(url);
  
  console.log('URL:', url);
  console.log('Hostname:', parsed.hostname);
  console.log('Port:', parsed.port || '(default)');
  console.log('Protocol:', parsed.protocol);
  
  // Resolve DNS
  const ips = await resolve4(parsed.hostname);
  console.log('Resolved IPs:', ips);
  
  const resolvedIp = ips[0];
  const port = parsed.port || 80;
  
  // Build fetch URL
  const fetchUrl = `${parsed.protocol}//${resolvedIp}:${port}${parsed.pathname}`;
  console.log('Fetch URL:', fetchUrl);
  
  // Try direct fetch
  console.log('\nTrying direct fetch...');
  try {
    const res = await fetch(fetchUrl, {
      method: 'GET',
      headers: {
        'Host': parsed.hostname,
        'User-Agent': 'Test/1.0',
      },
    });
    console.log('Status:', res.status);
    console.log('Body:', await res.text());
  } catch (err: any) {
    console.error('Fetch error:', err.message);
    console.error('Cause:', err.cause);
  }
}

test().catch(console.error);
