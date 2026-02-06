import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config } from '../config/index.js';
import { healthRoutes } from './routes/health.js';
import { agentRoutes } from './routes/agents.js';
import { statsRoutes } from './routes/stats.js';
import { capabilityRoutes } from './routes/capabilities.js';

export async function createServer() {
  const fastify = Fastify({
    logger: {
      level: 'info',
      transport: {
        target: 'pino-pretty',
        options: {
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      },
    },
    // Security: don't expose internal error details
    disableRequestLogging: false,
  });

  // CORS - restrictive by default
  await fastify.register(cors, {
    origin: process.env.CORS_ORIGIN || false,
    methods: ['GET', 'OPTIONS'],
  });

  // Rate limiting
  await fastify.register(rateLimit, {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.windowMs,
    errorResponseBuilder: () => ({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests, please slow down',
      },
    }),
  });

  // Request size limit
  fastify.addContentTypeParser('application/json', { bodyLimit: 1024 * 1024 }, (req, body, done) => {
    done(null, body);
  });

  // Global error handler - don't leak internal details
  fastify.setErrorHandler((error: Error & { statusCode?: number; code?: string }, request, reply) => {
    fastify.log.error(error);
    
    // Don't expose internal error details
    const statusCode = error.statusCode || 500;
    reply.code(statusCode).send({
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: statusCode < 500 
          ? error.message 
          : 'An internal error occurred',
      },
    });
  });

  // 404 handler
  fastify.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: {
        code: 'NOT_FOUND',
        message: `Route ${request.method} ${request.url} not found`,
      },
    });
  });

  // Register routes
  await fastify.register(healthRoutes);
  await fastify.register(agentRoutes);
  await fastify.register(statsRoutes);
  await fastify.register(capabilityRoutes);

  return fastify;
}

export async function startServer() {
  const server = await createServer();
  
  try {
    await server.listen({
      port: config.api.port,
      host: config.api.host,
    });
    console.log(`[API] Server listening on http://${config.api.host}:${config.api.port}`);
    return server;
  } catch (err) {
    server.log.error(err);
    throw err;
  }
}
