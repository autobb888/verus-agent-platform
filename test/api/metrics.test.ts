import { describe, it, expect } from 'vitest';

const API_URL = process.env.API_URL || 'http://127.0.0.1:3001';

describe('Metrics endpoint', () => {
  it('GET /metrics returns Prometheus format', async () => {
    const res = await fetch(`${API_URL}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');

    const text = await res.text();
    // Default Node.js metrics
    expect(text).toContain('process_cpu_user_seconds_total');
    expect(text).toContain('nodejs_eventloop_lag_seconds');

    // Custom VAP metrics
    expect(text).toContain('vap_jobs_created_total');
    expect(text).toContain('vap_jobs_completed_total');
    expect(text).toContain('vap_payments_verified_total');
    expect(text).toContain('vap_indexer_blocks_processed_total');
    expect(text).toContain('vap_auth_attempts_total');
    expect(text).toContain('vap_active_jobs');
    expect(text).toContain('vap_indexer_lag_blocks');
    expect(text).toContain('vap_ws_connections');
    expect(text).toContain('vap_http_request_duration_seconds');
  });

  it('indexer lag is a finite non-negative number', async () => {
    const res = await fetch(`${API_URL}/metrics`);
    const text = await res.text();
    const match = text.match(/vap_indexer_lag_blocks (\d+)/);
    expect(match).not.toBeNull();
    const lag = parseInt(match![1], 10);
    expect(lag).toBeGreaterThanOrEqual(0);
    expect(lag).toBeLessThan(100000);
  });
});
