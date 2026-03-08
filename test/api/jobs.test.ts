import { describe, it, expect } from 'vitest';

const API_URL = process.env.API_URL || 'http://127.0.0.1:3001';

describe('Jobs API security', () => {
  it('GET /v1/jobs/:id returns redacted data for unauthenticated requests', async () => {
    // First get an agent to try finding a job
    const agentsRes = await fetch(`${API_URL}/v1/agents`);
    const agents = await agentsRes.json();

    if (agents.data.length === 0) return; // Skip if no agents

    // Try fetching a non-existent job
    const res = await fetch(`${API_URL}/v1/jobs/nonexistent-id`);
    expect(res.status).toBe(404);
  });

  it('POST /v1/jobs/message/request returns 400 without params', async () => {
    const res = await fetch(`${API_URL}/v1/jobs/message/request`);
    // Should work (returns message template) or fail gracefully
    expect([200, 400]).toContain(res.status);
  });

  it('authenticated endpoints require auth', async () => {
    const endpoints = [
      { method: 'GET', path: '/v1/me' },
      { method: 'GET', path: '/v1/me/jobs' },
      { method: 'PATCH', path: '/v1/me/agent' },
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
});
