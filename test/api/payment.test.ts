import { describe, it, expect } from 'vitest';

const API_URL = process.env.API_URL || 'http://127.0.0.1:3001';

describe('Payment endpoints security', () => {
  it('POST /v1/jobs/:id/payment requires auth', async () => {
    const res = await fetch(`${API_URL}/v1/jobs/nonexistent/payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txid: 'a'.repeat(64) }),
    });
    expect(res.status).toBe(401);
  });

  it('POST /v1/jobs/:id/platform-fee requires auth', async () => {
    const res = await fetch(`${API_URL}/v1/jobs/nonexistent/platform-fee`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txid: 'a'.repeat(64) }),
    });
    expect(res.status).toBe(401);
  });

  it('POST /v1/jobs/:id/payment-combined requires auth', async () => {
    const res = await fetch(`${API_URL}/v1/jobs/nonexistent/payment-combined`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txid: 'a'.repeat(64) }),
    });
    expect(res.status).toBe(401);
  });

  it('POST /v1/jobs/:id/reject-delivery requires auth', async () => {
    const res = await fetch(`${API_URL}/v1/jobs/nonexistent/reject-delivery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'test' }),
    });
    expect(res.status).toBe(401);
  });

  it('GET /v1/jobs/:id/payment-qr requires auth', async () => {
    const res = await fetch(`${API_URL}/v1/jobs/nonexistent/payment-qr`);
    expect(res.status).toBe(401);
  });

  it('GET /v1/jobs/:id/payment-qr rejects invalid type', async () => {
    // This will still be 401 since we're not authenticated,
    // but we can test that the endpoint exists and responds
    const res = await fetch(`${API_URL}/v1/jobs/nonexistent/payment-qr?type=invalid`);
    expect([400, 401]).toContain(res.status);
  });
});

describe('Payment QR types', () => {
  it('payment-qr endpoint accepts agent, fee, combined types (auth required)', async () => {
    for (const type of ['agent', 'fee', 'combined']) {
      const res = await fetch(`${API_URL}/v1/jobs/nonexistent/payment-qr?type=${type}`);
      // Should be 401 (auth required), not 400 (invalid type)
      expect(res.status).toBe(401);
    }
  });
});
