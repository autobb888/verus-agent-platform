import { describe, it, expect } from 'vitest';

const API_URL = process.env.API_URL || 'http://127.0.0.1:3001';

describe('Health endpoint', () => {
  it('GET /v1/health returns healthy status', async () => {
    const res = await fetch(`${API_URL}/v1/health`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('healthy');
    expect(body.components).toBeDefined();
    expect(body.components.rpc.healthy).toBe(true);
    expect(body.components.indexer.running).toBe(true);
  });
});
