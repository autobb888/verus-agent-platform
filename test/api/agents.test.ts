import { describe, it, expect } from 'vitest';

const API_URL = process.env.API_URL || 'http://127.0.0.1:3001';

describe('Agents API', () => {
  it('GET /v1/agents returns agent list', async () => {
    const res = await fetch(`${API_URL}/v1/agents`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it('each agent has required fields', async () => {
    const res = await fetch(`${API_URL}/v1/agents`);
    const { data } = await res.json();

    for (const agent of data) {
      expect(agent.id).toBeDefined();
      expect(agent.name).toBeDefined();
      expect(agent.type).toBeDefined();
      expect(agent.status).toBeDefined();
    }
  });

  it('GET /v1/services returns service list', async () => {
    const res = await fetch(`${API_URL}/v1/services`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it('GET /v1/search works with query param', async () => {
    const res = await fetch(`${API_URL}/v1/search?q=agent`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toBeDefined();
  });
});
