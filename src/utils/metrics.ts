/**
 * Prometheus Metrics
 *
 * Exposes application metrics via GET /metrics endpoint.
 * Uses prom-client for Prometheus-compatible format.
 */

import { FastifyInstance } from 'fastify';
import client from 'prom-client';

// Collect default Node.js metrics (memory, CPU, event loop, etc.)
client.collectDefaultMetrics();

// --- Counters ---

export const jobsCreated = new client.Counter({
  name: 'vap_jobs_created_total',
  help: 'Total jobs created',
});

export const jobsCompleted = new client.Counter({
  name: 'vap_jobs_completed_total',
  help: 'Total jobs completed',
});

export const paymentsVerified = new client.Counter({
  name: 'vap_payments_verified_total',
  help: 'Total payments verified on-chain',
  labelNames: ['type'] as const, // 'agent', 'fee', 'combined'
});

export const indexerBlocksProcessed = new client.Counter({
  name: 'vap_indexer_blocks_processed_total',
  help: 'Total blocks processed by the indexer',
});

export const authAttempts = new client.Counter({
  name: 'vap_auth_attempts_total',
  help: 'Total authentication attempts',
  labelNames: ['result'] as const, // 'success', 'failure'
});

// --- Gauges ---

export const activeJobs = new client.Gauge({
  name: 'vap_active_jobs',
  help: 'Number of currently active jobs (in_progress + delivered)',
});

export const indexerLag = new client.Gauge({
  name: 'vap_indexer_lag_blocks',
  help: 'Number of blocks the indexer is behind the chain tip',
});

export const wsConnections = new client.Gauge({
  name: 'vap_ws_connections',
  help: 'Number of active WebSocket connections',
});

// --- Histograms ---

export const requestDuration = new client.Histogram({
  name: 'vap_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

/**
 * Register the /metrics endpoint and request duration tracking
 */
export async function metricsRoutes(fastify: FastifyInstance): Promise<void> {
  // Track request duration for all routes
  fastify.addHook('onResponse', (request, reply, done) => {
    // Use route template (e.g. /v1/jobs/:id) to prevent cardinality explosion.
    // Only falls back to raw URL for 404s, which have bounded cardinality via status_code.
    const route = request.routeOptions?.url || '(unmatched)';
    if (route === '/metrics') {
      done();
      return;
    }
    const duration = reply.elapsedTime / 1000;
    requestDuration
      .labels(request.method, route, String(reply.statusCode))
      .observe(duration);
    done();
  });

  // Restrict /metrics to localhost / internal scrapers
  fastify.get('/metrics', async (request, reply) => {
    const ip = request.ip;
    if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1' && !ip.startsWith('172.') && !ip.startsWith('10.')) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Metrics only available from internal networks' } });
    }
    reply.header('Content-Type', client.register.contentType);
    return client.register.metrics();
  });
}
