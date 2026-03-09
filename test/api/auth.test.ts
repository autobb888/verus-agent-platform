import { describe, it, expect } from 'vitest';

const API_URL = process.env.API_URL || 'http://127.0.0.1:3001';

describe('Auth API', () => {
  it('GET /auth/challenge returns a challenge', async () => {
    const res = await fetch(`${API_URL}/auth/challenge?verusId=test.agentplatform@`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(body.data.challenge).toBeDefined();
    expect(body.data.challenge.length).toBeGreaterThan(0);
  });

  it('POST /auth/login rejects invalid signature', async () => {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        verusId: 'test.agentplatform@',
        challenge: 'fake-challenge',
        signature: 'fake-signature',
      }),
    });
    // Should reject with 400 or 401
    expect([400, 401]).toContain(res.status);
  });

  it('GET /auth/challenge works without verusId param', async () => {
    const res = await fetch(`${API_URL}/auth/challenge`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.challenge).toBeDefined();
  });

  it('GET /auth/session returns unauthenticated without cookie', async () => {
    const res = await fetch(`${API_URL}/auth/session`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.authenticated).toBe(false);
  });
});
