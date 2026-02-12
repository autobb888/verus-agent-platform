import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import { config } from '../config/index.js';
import { healthRoutes } from './routes/health.js';
import { agentRoutes } from './routes/agents.js';
import { statsRoutes } from './routes/stats.js';
import { capabilityRoutes } from './routes/capabilities.js';
import { registrationRoutes } from './routes/registration.js';
import { verificationRoutes } from './routes/verification.js';
import { authRoutes } from './routes/auth.js';
import { searchRoutes } from './routes/search.js';
import { serviceRoutes } from './routes/services.js';
import { reviewRoutes } from './routes/reviews.js';
import { myServiceRoutes } from './routes/my-services.js';
import { submitReviewRoutes } from './routes/submit-review.js';
import { inboxRoutes } from './routes/inbox.js';
import { jobRoutes } from './routes/jobs.js';
import { paymentQrRoutes } from './routes/payment-qr.js';
import { chatRoutes } from './routes/chat.js';
import { fileRoutes } from './routes/files.js';
import { transparencyRoutes } from './routes/transparency.js';
import { alertRoutes } from './routes/alerts.js';
import { resolveNameRoutes } from './routes/resolve-names.js';
import { profileRoutes } from './routes/profile.js';
import { webhookRoutes } from './routes/webhooks.js';
import { notificationRoutes } from './routes/notifications.js';
import { dataPolicyRoutes } from './routes/data-policies.js';
import { transactionRoutes } from './routes/transactions.js';
import { onboardRoutes } from './routes/onboard.js';
import { canaryRoutes } from './routes/canary.js';
import { pricingRoutes } from './routes/pricing.js';
import { attestationRoutes } from './routes/attestations.js';
import multipart from '@fastify/multipart';
import helmet from '@fastify/helmet';
import { initNonceStore } from '../auth/nonce-store.js';
import { initSocketServer, setSafeChatEngine, setOutputScanEngine } from '../chat/ws-server.js';

export async function createServer() {
  const isProduction = process.env.NODE_ENV === 'production';

  const fastify = Fastify({
    logger: isProduction
      ? { level: 'info' }
      : {
          level: 'info',
          transport: {
            target: 'pino-pretty',
            options: {
              translateTime: 'HH:MM:ss Z',
              ignore: 'pid,hostname',
            },
          },
        },
    trustProxy: isProduction,
    // Security: don't expose internal error details
    disableRequestLogging: false,
    // Request body size limit (1MB)
    bodyLimit: 1024 * 1024,
  });

  // CORS - restrictive by default
  await fastify.register(cors, {
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()) : false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true, // Allow cookies
  });

  // Security headers
  await fastify.register(helmet, {
    contentSecurityPolicy: false, // CSP handled per-route where needed
    crossOriginEmbedderPolicy: false, // Allow dashboard to load resources
  });

  // Cookie support for sessions
  // P2-COOKIE-1: Require COOKIE_SECRET in production
  const cookieSecret = process.env.COOKIE_SECRET || (
    process.env.NODE_ENV === 'production'
      ? (() => { throw new Error('COOKIE_SECRET environment variable is required in production'); })()
      : 'dev-secret-change-in-production'
  );
  await fastify.register(cookie, {
    secret: cookieSecret as string,
  });

  // Rate limiting
  await fastify.register(rateLimit, {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.windowMs,
    errorResponseBuilder: (_req: any, context: any) => {
      const err = new Error('Too many requests, please slow down') as any;
      err.statusCode = context.statusCode || 429;
      err.code = 'RATE_LIMITED';
      return err;
    },
  });

  // Multipart file uploads (Phase 6b)
  await fastify.register(multipart, {
    limits: {
      fileSize: 25 * 1024 * 1024, // 25MB
      files: 1, // One file per request
    },
  });

  // Request body size limit is set in Fastify constructor

  // Global error handler - don't leak internal details
  fastify.setErrorHandler((error: Error & { statusCode?: number; code?: string }, request, reply) => {
    // Only log server errors at error level; client errors at warn
    if (!error.statusCode || error.statusCode >= 500) {
      fastify.log.error(error);
    } else {
      fastify.log.warn({ statusCode: error.statusCode, code: error.code, message: error.message }, 'client error');
    }
    
    // Don't expose internal error details
    const statusCode = error.statusCode || 500;
    reply.code(statusCode).send({
      error: {
        code: error.code === 'FST_ERR_RATE_LIMIT_EXCEEDED' ? 'RATE_LIMITED' : (error.code || 'INTERNAL_ERROR'),
        message: error.message || 'An internal error occurred',
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

  // Initialize nonce store for replay protection
  initNonceStore();

  // Register routes
  await fastify.register(healthRoutes);
  await fastify.register(agentRoutes);
  await fastify.register(statsRoutes);
  await fastify.register(capabilityRoutes);
  await fastify.register(registrationRoutes);
  await fastify.register(verificationRoutes);
  await fastify.register(authRoutes);
  await fastify.register(searchRoutes);
  await fastify.register(serviceRoutes);
  await fastify.register(reviewRoutes);
  await fastify.register(myServiceRoutes);
  await fastify.register(submitReviewRoutes);
  await fastify.register(inboxRoutes);
  await fastify.register(jobRoutes);
  await fastify.register(paymentQrRoutes);
  await fastify.register(chatRoutes);
  await fastify.register(fileRoutes);
  await fastify.register(transparencyRoutes);
  await fastify.register(alertRoutes);
  await fastify.register(resolveNameRoutes);
  await fastify.register(webhookRoutes);
  await fastify.register(notificationRoutes);
  await fastify.register(dataPolicyRoutes);
  await fastify.register(transactionRoutes);
  await fastify.register(onboardRoutes);
  await fastify.register(canaryRoutes);
  await fastify.register(pricingRoutes);
  await fastify.register(attestationRoutes);
  await fastify.register(profileRoutes);

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

    // Initialize Socket.IO on the underlying HTTP server
    const httpServer = server.server;
    const io = initSocketServer(httpServer);
    console.log('[Chat] Socket.IO server initialized on /ws');

    // Initialize SafeChat engine
    try {
      // @ts-ignore - SafeChat is an external package loaded at runtime
      const safechatPath = process.env.SAFECHAT_PATH || '/home/cluster/safechat/dist/index.js';
      const { SafeChatEngine } = await import(safechatPath) as any;
      const engine = new SafeChatEngine();
      setSafeChatEngine(engine);
      setOutputScanEngine(engine);
      console.log('[Chat] SafeChat engine initialized (inbound + outbound)');
    } catch (err) {
      console.warn('[Chat] SafeChat engine not available, running without safety scanning:', (err as Error).message);
    }

    return server;
  } catch (err) {
    server.log.error(err);
    throw err;
  }
}
