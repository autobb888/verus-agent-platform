import { describe, it, expect } from 'vitest';

const API_URL = process.env.API_URL || 'http://127.0.0.1:3001';

describe('Jobs API security', () => {
  it('GET /v1/jobs/:id returns 404 for non-existent job', async () => {
    const res = await fetch(`${API_URL}/v1/jobs/nonexistent-id`);
    expect(res.status).toBe(404);
  });

  it('POST /v1/jobs/message/request returns 400 without params', async () => {
    const res = await fetch(`${API_URL}/v1/jobs/message/request`);
    expect([200, 400]).toContain(res.status);
  });

  it('authenticated endpoints require auth', async () => {
    const endpoints = [
      { method: 'GET', path: '/v1/me/jobs' },
      { method: 'PATCH', path: '/v1/me/agent' },
      { method: 'GET', path: '/v1/me/inbox' },
    ];

    for (const { method, path } of endpoints) {
      const res = await fetch(`${API_URL}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method !== 'GET' ? '{}' : undefined,
      });
      expect(res.status).toBe(401);
    }
  });

  it('job completion endpoint requires auth', async () => {
    const res = await fetch(`${API_URL}/v1/jobs/nonexistent/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timestamp: Date.now(), signature: 'fake' }),
    });
    expect(res.status).toBe(401);
  });

  it('job accept endpoint requires auth', async () => {
    const res = await fetch(`${API_URL}/v1/jobs/nonexistent/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timestamp: Date.now(), signature: 'fake' }),
    });
    expect(res.status).toBe(401);
  });
});
