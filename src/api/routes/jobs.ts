/**
 * A2A Jobs API (Phase 4)
 * 
 * Agent-to-Agent job lifecycle with signed commitments.
 * 
 * Flow:
 * 1. Buyer creates job request (signed) → seller gets notification
 * 2. Seller accepts (signed) → buyer gets signed acceptance as proof
 * 3. Seller delivers (signed) → buyer gets delivery notification
 * 4. Buyer confirms completion (signed) → job done, ready for reviews
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createHash, randomUUID } from 'crypto';
import { jobQueries, jobMessageQueries, jobExtensionQueries, agentQueries, serviceQueries, inboxQueries, getDatabase } from '../../db/index.js';
import { emitWebhookEvent } from '../../notifications/webhook-engine.js';
import { createNotification } from './notifications.js';
import { getRpcClient } from '../../indexer/rpc-client.js';
import { getSessionFromRequest } from './auth.js';

// P4-RATE-1: Rate limiting for job creation
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_JOBS_PER_IP = 10;
const MAX_JOBS_PER_BUYER = 5;

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const ipRateLimits = new Map<string, RateLimitEntry>();
const buyerRateLimits = new Map<string, RateLimitEntry>();
const messageUserRateLimits = new Map<string, RateLimitEntry>();
const messageJobRateLimits = new Map<string, RateLimitEntry>();

const MAX_MESSAGES_PER_USER = 30; // per minute
const MAX_MESSAGES_PER_JOB = 60;  // per minute

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of ipRateLimits) {
    if (entry.resetAt < now) ipRateLimits.delete(key);
  }
  for (const [key, entry] of buyerRateLimits) {
    if (entry.resetAt < now) buyerRateLimits.delete(key);
  }
  for (const [key, entry] of messageUserRateLimits) {
    if (entry.resetAt < now) messageUserRateLimits.delete(key);
  }
  for (const [key, entry] of messageJobRateLimits) {
    if (entry.resetAt < now) messageJobRateLimits.delete(key);
  }
}, 5 * 60 * 1000);

function checkRateLimit(
  map: Map<string, RateLimitEntry>,
  key: string,
  maxRequests: number
): boolean {
  const now = Date.now();
  const entry = map.get(key);

  if (!entry || entry.resetAt < now) {
    map.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (entry.count >= maxRequests) {
    return false;
  }

  entry.count++;
  return true;
}

// Schema for creating a job request
const createJobSchema = z.object({
  sellerVerusId: z.string().min(1).max(100),
  serviceId: z.string().max(100).optional(),
  description: z.string().min(1).max(2000),
  amount: z.coerce.number().min(0),
  currency: z.string().default('VRSCTEST'),
  deadline: z.string().max(100).optional(),
  paymentTerms: z.enum(['prepay', 'postpay', 'split']).default('prepay'),
  paymentAddress: z.string().max(100).optional(),
  dataTerms: z.object({
    retention: z.enum(['none', 'job-duration', '30-days']).default('none'),
    allowTraining: z.boolean().default(false),
    allowThirdParty: z.boolean().default(false),
    requireDeletionAttestation: z.boolean().default(false),
  }).optional(),
  safechatEnabled: z.boolean().default(true),
  privateMode: z.boolean().default(false),
  fee: z.coerce.number().min(0).optional(),  // Platform fee amount (for signature verification)
  timestamp: z.number(),
  signature: z.string().min(1),
});

// SafeChat fee address (dedicated VerusID for collecting fees)
const SAFECHAT_FEE_ADDRESS = process.env.SAFECHAT_FEE_ADDRESS || 'RAWwNeTLRg9urgnDPQtPyZ6NRycsmSY2J2';

// Platform fee base rate: 5%
const BASE_FEE_RATE = 0.05;

/**
 * Calculate the discounted platform fee rate based on data sharing preferences.
 * Sharing data = cheaper job. Data has value.
 * - Allow training: -10% off fee
 * - Allow third-party sharing: -10% off fee
 * - No deletion attestation: -5% off fee
 * Max discount: 25% off the 5% fee → effective 3.75%
 */
function calculateFeeRate(dataTerms?: { allowTraining?: boolean; allowThirdParty?: boolean; requireDeletionAttestation?: boolean }): number {
  if (!dataTerms) return BASE_FEE_RATE;
  let discount = 0;
  if (dataTerms.allowTraining) discount += 0.10;
  if (dataTerms.allowThirdParty) discount += 0.10;
  if (!dataTerms.requireDeletionAttestation) discount += 0.05;
  return BASE_FEE_RATE * (1 - discount);
}

// Schema for accepting a job
const acceptJobSchema = z.object({
  timestamp: z.number(),
  signature: z.string().min(1),
});

// Schema for delivering a job
const deliverJobSchema = z.object({
  deliveryHash: z.string().min(1).max(500),
  deliveryMessage: z.string().max(2000).optional(),
  timestamp: z.number(),
  signature: z.string().min(1),
});

// Schema for completing a job
const completeJobSchema = z.object({
  timestamp: z.number(),
  signature: z.string().min(1),
});

/**
 * Generate a unique job hash from key fields
 */
function generateJobHash(
  buyerVerusId: string,
  sellerVerusId: string,
  description: string,
  amount: number,
  timestamp: number
): string {
  const data = `${buyerVerusId}:${sellerVerusId}:${description}:${amount}:${timestamp}`;
  return createHash('sha256').update(data).digest('hex').slice(0, 32);
}

/**
 * Generate the message format for job request signature
 */
function generateJobRequestMessage(
  sellerVerusId: string,
  description: string,
  amount: number,
  currency: string,
  deadline: string | undefined,
  timestamp: number,
  safechatEnabled: boolean = true,
  feeAmount?: number
): string {
  // Use provided fee amount (from buyer's signed message) or fall back to base 5%
  const fee = feeAmount !== undefined ? feeAmount : (amount * 0.05);
  return `VAP-JOB|To:${sellerVerusId}|Desc:${description}|Amt:${amount} ${currency}|Fee:${fee.toFixed(4)} ${currency}|SafeChat:${safechatEnabled ? 'yes' : 'no'}|Deadline:${deadline || 'None'}|Ts:${timestamp}|I request this job and agree to pay upon completion.`;
}

/**
 * Generate the message format for job acceptance signature
 */
function generateJobAcceptanceMessage(
  jobHash: string,
  buyerVerusId: string,
  amount: number,
  currency: string,
  timestamp: number
): string {
  return `VAP-ACCEPT|Job:${jobHash}|Buyer:${buyerVerusId}|Amt:${amount} ${currency}|Ts:${timestamp}|I accept this job and commit to delivering the work.`;
}

/**
 * Generate the message format for delivery signature
 */
function generateDeliveryMessage(
  jobHash: string,
  deliveryHash: string,
  timestamp: number
): string {
  return `VAP-DELIVER|Job:${jobHash}|Delivery:${deliveryHash}|Ts:${timestamp}|I have delivered the work for this job.`;
}

/**
 * Generate the message format for completion signature
 */
function generateCompletionMessage(
  jobHash: string,
  timestamp: number
): string {
  return `VAP-COMPLETE|Job:${jobHash}|Ts:${timestamp}|I confirm the work has been delivered satisfactorily.`;
}

// Auth middleware
async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return reply.code(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  }
  (request as any).session = session;
}

export async function jobRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ==========================================
  // Public endpoints
  // ==========================================

  /**
   * GET /v1/jobs/:id
   * Get a job by ID (public)
   */
  fastify.get('/v1/jobs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = jobQueries.getById(id);
    
    if (!job) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Job not found' },
      });
    }

    return { data: formatJob(job) };
  });

  /**
   * GET /v1/jobs/hash/:hash
   * Get a job by hash (public)
   */
  fastify.get('/v1/jobs/hash/:hash', async (request, reply) => {
    const { hash } = request.params as { hash: string };
    const job = jobQueries.getByHash(hash);
    
    if (!job) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Job not found' },
      });
    }

    return { data: formatJob(job) };
  });

  /**
   * GET /v1/jobs/message/request
   * Get the message format for signing a job request
   */
  fastify.get('/v1/jobs/message/request', async (request, reply) => {
    const query = request.query as Record<string, string>;
    
    const sellerVerusId = query.sellerVerusId;
    const description = query.description;
    const amount = parseFloat(query.amount || '0');
    const currency = query.currency || 'VRSCTEST';
    const deadline = query.deadline;
    const timestamp = parseInt(query.timestamp || String(Math.floor(Date.now() / 1000)), 10);

    if (!sellerVerusId || !description || !amount) {
      return reply.code(400).send({
        error: { code: 'MISSING_PARAMS', message: 'sellerVerusId, description, and amount are required' },
      });
    }

    const safechatEnabled = (request.body as any)?.safechatEnabled !== false;
    const message = generateJobRequestMessage(sellerVerusId, description, amount, currency, deadline, timestamp, safechatEnabled);

    return {
      data: {
        message,
        timestamp,
        feeAmount: (amount * 0.05).toFixed(4),
        totalCost: (amount * 1.05).toFixed(4),
        instructions: [
          '1. Copy the message above',
          '2. Sign it with: verus -testnet signmessage "yourID@" "<message>"',
          '3. Submit to POST /v1/jobs with the signature',
        ],
      },
    };
  });

  // ==========================================
  // Authenticated endpoints
  // ==========================================

  /**
   * GET /v1/me/jobs
   * Get my jobs (as buyer or seller)
   */
  fastify.get('/v1/me/jobs', { preHandler: requireAuth }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const query = request.query as Record<string, string>;
    
    const role = query.role as 'buyer' | 'seller' | undefined;
    const status = query.status;
    const limit = Math.min(parseInt(query.limit || '20', 10), 100);
    const offset = parseInt(query.offset || '0', 10);

    let jobs;
    if (role === 'buyer') {
      jobs = jobQueries.getByBuyer(session.verusId, status, limit, offset);
    } else if (role === 'seller') {
      jobs = jobQueries.getBySeller(session.verusId, status, limit, offset);
    } else {
      // Get both
      const buyerJobs = jobQueries.getByBuyer(session.verusId, status, limit, offset);
      const sellerJobs = jobQueries.getBySeller(session.verusId, status, limit, offset);
      jobs = [...buyerJobs, ...sellerJobs]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, limit);
    }

    // Get counts by status
    const buyerCounts = jobQueries.countByStatus(session.verusId, 'buyer');
    const sellerCounts = jobQueries.countByStatus(session.verusId, 'seller');

    return {
      data: jobs.map(formatJob),
      meta: {
        asBuyer: Object.fromEntries(buyerCounts.map(c => [c.status, c.count])),
        asSeller: Object.fromEntries(sellerCounts.map(c => [c.status, c.count])),
      },
    };
  });

  /**
   * POST /v1/jobs
   * Create a new job request (authenticated, buyer initiates)
   */
  fastify.post('/v1/jobs', { preHandler: requireAuth }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    
    // P4-RATE-1: Check IP rate limit
    const clientIp = request.ip;
    if (!checkRateLimit(ipRateLimits, clientIp, MAX_JOBS_PER_IP)) {
      return reply.code(429).send({
        error: { code: 'RATE_LIMITED', message: 'Too many job requests. Please wait before trying again.' },
      });
    }

    // P4-RATE-1: Check buyer rate limit
    if (!checkRateLimit(buyerRateLimits, session.verusId, MAX_JOBS_PER_BUYER)) {
      return reply.code(429).send({
        error: { code: 'RATE_LIMITED', message: 'Too many job requests from this identity. Please wait.' },
      });
    }

    const parsed = createJobSchema.safeParse(request.body);
    
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid job data', details: parsed.error.errors },
      });
    }

    const data = parsed.data;
    const { sellerVerusId, serviceId, description, amount, currency, deadline, timestamp, signature, fee } = data;
    const buyerVerusId = session.verusId;

    // P2-VAP-004: Validate timestamp (within 10 minutes)
    const now = Math.floor(Date.now() / 1000);
    if (timestamp < now - 600 || timestamp > now + 300) {
      return reply.code(400).send({
        error: { code: 'INVALID_TIMESTAMP', message: 'Timestamp must be within the last 10 minutes' },
      });
    }

    // Resolve seller
    const rpc = getRpcClient();
    let sellerIAddress: string;
    try {
      const sellerIdentity = await rpc.getIdentity(sellerVerusId);
      sellerIAddress = sellerIdentity.identity.identityaddress;
      
      // Check seller is registered
      const seller = agentQueries.getById(sellerIAddress);
      if (!seller) {
        return reply.code(404).send({
          error: { code: 'SELLER_NOT_FOUND', message: 'Seller agent not found in registry' },
        });
      }
    } catch {
      return reply.code(404).send({
        error: { code: 'SELLER_NOT_FOUND', message: 'Could not resolve seller identity' },
      });
    }

    // Verify service exists if specified
    if (serviceId) {
      const service = serviceQueries.getById(serviceId);
      if (!service || service.verus_id !== sellerIAddress) {
        return reply.code(404).send({
          error: { code: 'SERVICE_NOT_FOUND', message: 'Service not found or does not belong to seller' },
        });
      }
    }

    // Verify buyer's signature
    const expectedMessage = generateJobRequestMessage(sellerVerusId, description, amount, currency, deadline, timestamp, data.safechatEnabled, fee);
    fastify.log.info({ 
      buyerVerusId, 
      sellerVerusId,
      expectedMessage,
      signaturePreview: signature.slice(0, 30),
      timestamp,
      description: description.slice(0, 100),
      amount,
      currency,
      deadline,
    }, 'Verifying job request signature');
    let isValid: boolean;
    try {
      isValid = await rpc.verifyMessage(buyerVerusId, expectedMessage, signature);
      fastify.log.info({ isValid }, 'Signature verification result');
    } catch (error) {
      fastify.log.error({ error }, 'Signature verification failed');
      return reply.code(400).send({
        error: { code: 'VERIFICATION_FAILED', message: 'Could not verify signature' },
      });
    }

    if (!isValid) {
      return reply.code(401).send({
        error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed' },
      });
    }

    // Generate job hash
    const jobHash = generateJobHash(buyerVerusId, sellerIAddress, description, amount, timestamp);

    // Check for duplicate
    const existing = jobQueries.getByHash(jobHash);
    if (existing) {
      return reply.code(409).send({
        error: { code: 'DUPLICATE_JOB', message: 'A job with these parameters already exists' },
      });
    }

    // Get payment address from service/seller if available
    let paymentAddress = data.paymentAddress || null;
    if (!paymentAddress && serviceId) {
      const service = serviceQueries.getById(serviceId);
      if (service) {
        // Use seller's identity address as default payment address
        paymentAddress = sellerIAddress;
      }
    }

    // Create job
    const jobId = jobQueries.insert({
      job_hash: jobHash,
      buyer_verus_id: buyerVerusId,
      seller_verus_id: sellerIAddress,
      service_id: serviceId || null,
      description,
      amount,
      currency,
      deadline: deadline || null,
      payment_terms: data.paymentTerms,
      payment_address: paymentAddress,
      payment_txid: null,
      payment_verified: 0,
      platform_fee_txid: null,
      platform_fee_verified: 0,
      safechat_enabled: data.safechatEnabled ? 1 : 0,
      request_signature: signature,
      acceptance_signature: null,
      delivery_signature: null,
      completion_signature: null,
      status: 'requested',
      delivery_hash: null,
      delivery_message: null,
      requested_at: new Date(timestamp * 1000).toISOString(),
      accepted_at: null,
      delivered_at: null,
      completed_at: null,
    });

    // Notify seller via inbox
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    inboxQueries.insert({
      recipient_verus_id: sellerIAddress,
      type: 'job_request',
      sender_verus_id: buyerVerusId,
      job_hash: jobHash,
      rating: null,
      message: description,
      signature,
      status: 'pending',
      expires_at: expiresAt,
      vdxf_data: JSON.stringify({ jobId, amount, currency }),
    });

    // Save data handling terms if provided
    if (parsed.data.dataTerms) {
      const dt = parsed.data.dataTerms;
      const db = getDatabase();
      db.prepare(`
        INSERT INTO job_data_terms (id, job_id, retention, allow_training, allow_third_party, require_deletion_attestation)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), jobId, dt.retention, dt.allowTraining ? 1 : 0, dt.allowThirdParty ? 1 : 0, dt.requireDeletionAttestation ? 1 : 0);
    }

    fastify.log.info({ jobId, jobHash, buyer: buyerVerusId, seller: sellerIAddress }, 'Job created');

    // Notify seller via webhook
    emitWebhookEvent({ type: 'job.requested', agentVerusId: sellerIAddress, jobId, data: { buyerVerusId, description, amount, currency } });
    createNotification({ recipientVerusId: sellerIAddress, type: 'job.requested', title: 'New Job Request', body: description?.slice(0, 200), jobId });

    const job = jobQueries.getById(jobId);
    return reply.code(201).send({ data: formatJob(job!) });
  });

  /**
   * POST /v1/jobs/:id/accept
   * Accept a job (seller)
   */
  fastify.post('/v1/jobs/:id/accept', { preHandler: requireAuth }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const { id } = request.params as { id: string };
    const parsed = acceptJobSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid acceptance data', details: parsed.error.errors },
      });
    }

    const { timestamp, signature } = parsed.data;

    // Get job
    const job = jobQueries.getById(id);
    if (!job) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Job not found' },
      });
    }

    // Verify caller is seller
    if (job.seller_verus_id !== session.verusId) {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'Only the seller can accept this job' },
      });
    }

    // Verify status
    if (job.status !== 'requested') {
      return reply.code(400).send({
        error: { code: 'INVALID_STATUS', message: `Cannot accept job in status: ${job.status}` },
      });
    }

    // Verify signature
    const expectedMessage = generateJobAcceptanceMessage(
      job.job_hash,
      job.buyer_verus_id,
      job.amount,
      job.currency,
      timestamp
    );

    const rpc = getRpcClient();
    let isValid: boolean;
    try {
      isValid = await rpc.verifyMessage(session.verusId, expectedMessage, signature);
    } catch {
      return reply.code(400).send({
        error: { code: 'VERIFICATION_FAILED', message: 'Could not verify signature' },
      });
    }

    if (!isValid) {
      return reply.code(401).send({
        error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed' },
      });
    }

    // Update job (P4-RACE-1: atomic update)
    const success = jobQueries.setAccepted(id, signature);
    if (!success) {
      return reply.code(409).send({
        error: { code: 'STATE_CONFLICT', message: 'Job was modified by another request' },
      });
    }

    // Notify buyer
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    inboxQueries.insert({
      recipient_verus_id: job.buyer_verus_id,
      type: 'job_accepted',
      sender_verus_id: session.verusId,
      job_hash: job.job_hash,
      rating: null,
      message: `Job accepted. Seller has committed to delivering the work.`,
      signature,
      status: 'pending',
      expires_at: expiresAt,
      vdxf_data: JSON.stringify({ jobId: id, acceptanceSignature: signature }),
    });

    // Mark data terms as accepted by seller
    const db2 = getDatabase();
    db2.prepare(`UPDATE job_data_terms SET accepted_by_seller = 1, accepted_at = datetime('now') WHERE job_id = ?`).run(id);

    fastify.log.info({ jobId: id, seller: session.verusId }, 'Job accepted');
    emitWebhookEvent({ type: 'job.accepted', agentVerusId: job.buyer_verus_id, jobId: id, data: { sellerVerusId: session.verusId } });
    emitWebhookEvent({ type: 'job.accepted', agentVerusId: session.verusId, jobId: id, data: { buyerVerusId: job.buyer_verus_id } });
    createNotification({ recipientVerusId: job.buyer_verus_id, type: 'job.accepted', title: 'Job Accepted', body: 'Your job has been accepted by the seller', jobId: id });

    const updated = jobQueries.getById(id);
    return { data: formatJob(updated!) };
  });

  /**
   * POST /v1/jobs/:id/deliver
   * Mark job as delivered (seller)
   */
  fastify.post('/v1/jobs/:id/deliver', { preHandler: requireAuth }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const { id } = request.params as { id: string };
    const parsed = deliverJobSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid delivery data', details: parsed.error.errors },
      });
    }

    const { deliveryHash, deliveryMessage, timestamp, signature } = parsed.data;

    const job = jobQueries.getById(id);
    if (!job) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Job not found' },
      });
    }

    if (job.seller_verus_id !== session.verusId) {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'Only the seller can deliver this job' },
      });
    }

    if (!['accepted', 'in_progress'].includes(job.status)) {
      return reply.code(400).send({
        error: { code: 'INVALID_STATUS', message: `Cannot deliver job in status: ${job.status}` },
      });
    }

    // Verify signature
    const expectedMessage = generateDeliveryMessage(job.job_hash, deliveryHash, timestamp);
    const rpc = getRpcClient();
    let isValid: boolean;
    try {
      isValid = await rpc.verifyMessage(session.verusId, expectedMessage, signature);
    } catch {
      return reply.code(400).send({
        error: { code: 'VERIFICATION_FAILED', message: 'Could not verify signature' },
      });
    }

    if (!isValid) {
      return reply.code(401).send({
        error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed' },
      });
    }

    // Update job (P4-RACE-1: atomic update)
    const success = jobQueries.setDelivered(id, signature, deliveryHash, deliveryMessage);
    if (!success) {
      return reply.code(409).send({
        error: { code: 'STATE_CONFLICT', message: 'Job was modified by another request' },
      });
    }

    // Notify buyer
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    inboxQueries.insert({
      recipient_verus_id: job.buyer_verus_id,
      type: 'job_delivered',
      sender_verus_id: session.verusId,
      job_hash: job.job_hash,
      rating: null,
      message: deliveryMessage || 'Work delivered. Please review and confirm completion.',
      signature,
      status: 'pending',
      expires_at: expiresAt,
      vdxf_data: JSON.stringify({ jobId: id, deliveryHash, deliverySignature: signature }),
    });

    fastify.log.info({ jobId: id, seller: session.verusId, deliveryHash }, 'Job delivered');
    emitWebhookEvent({ type: 'job.delivered', agentVerusId: job.buyer_verus_id, jobId: id, data: { deliveryHash } });
    createNotification({ recipientVerusId: job.buyer_verus_id, type: 'job.delivered', title: 'Delivery Ready', body: 'Your job has been delivered — review and complete it', jobId: id });

    const updated = jobQueries.getById(id);
    return { data: formatJob(updated!) };
  });

  /**
   * POST /v1/jobs/:id/complete
   * Confirm job completion (buyer)
   */
  fastify.post('/v1/jobs/:id/complete', { preHandler: requireAuth }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const { id } = request.params as { id: string };
    const parsed = completeJobSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid completion data', details: parsed.error.errors },
      });
    }

    const { timestamp, signature } = parsed.data;

    const job = jobQueries.getById(id);
    if (!job) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Job not found' },
      });
    }

    if (job.buyer_verus_id !== session.verusId) {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'Only the buyer can complete this job' },
      });
    }

    if (job.status !== 'delivered') {
      return reply.code(400).send({
        error: { code: 'INVALID_STATUS', message: `Cannot complete job in status: ${job.status}` },
      });
    }

    // Verify signature
    const expectedMessage = generateCompletionMessage(job.job_hash, timestamp);
    const rpc = getRpcClient();
    let isValid: boolean;
    try {
      isValid = await rpc.verifyMessage(session.verusId, expectedMessage, signature);
    } catch {
      return reply.code(400).send({
        error: { code: 'VERIFICATION_FAILED', message: 'Could not verify signature' },
      });
    }

    if (!isValid) {
      return reply.code(401).send({
        error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed' },
      });
    }

    // Update job (P4-RACE-1: atomic update)
    const success = jobQueries.setCompleted(id, signature);
    if (!success) {
      return reply.code(409).send({
        error: { code: 'STATE_CONFLICT', message: 'Job was modified by another request' },
      });
    }

    // Notify seller
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    inboxQueries.insert({
      recipient_verus_id: job.seller_verus_id,
      type: 'job_completed',
      sender_verus_id: session.verusId,
      job_hash: job.job_hash,
      rating: null,
      message: 'Job completed! Buyer has confirmed delivery.',
      signature,
      status: 'pending',
      expires_at: expiresAt,
      vdxf_data: JSON.stringify({ jobId: id, completionSignature: signature }),
    });

    fastify.log.info({ jobId: id, buyer: session.verusId }, 'Job completed');
    emitWebhookEvent({ type: 'job.completed', agentVerusId: job.seller_verus_id, jobId: id, data: { buyerVerusId: session.verusId } });
    createNotification({ recipientVerusId: job.seller_verus_id, type: 'job.completed', title: 'Job Completed', body: 'The buyer has confirmed job completion', jobId: id });

    // If data terms require deletion attestation, notify seller
    const dataTerms = getDatabase().prepare(`SELECT * FROM job_data_terms WHERE job_id = ? AND require_deletion_attestation = 1`).get(id) as any;
    if (dataTerms) {
      createNotification({
        recipientVerusId: job.seller_verus_id,
        type: 'deletion.requested',
        title: 'Deletion Attestation Required',
        body: 'This job requires you to attest to data deletion. Please sign a deletion attestation.',
        jobId: id,
      });
    }

    // First-job startup fund recoup: deduct 0.0033 VRSCTEST from seller's first completed job
    try {
      const db = getDatabase();
      const seller = db.prepare(`SELECT id, startup_recouped FROM agents WHERE verus_id = ?`).get(job.seller_verus_id) as any;
      if (seller && !seller.startup_recouped) {
        const onboardRow = db.prepare(
          `SELECT funded_amount FROM onboard_requests WHERE status = 'registered' AND address IN (
            SELECT json_each.value FROM agents, json_each(agents.primary_addresses) WHERE agents.verus_id = ?
          )`
        ).get(job.seller_verus_id) as any;
        
        if (onboardRow?.funded_amount) {
          // Mark as recouped (actual deduction happens in payment settlement)
          db.prepare(`UPDATE agents SET startup_recouped = 1 WHERE id = ?`).run(seller.id);
          fastify.log.info({ sellerId: job.seller_verus_id, amount: onboardRow.funded_amount }, 'Startup fund recoup marked on first job completion');
        }
      }
    } catch (err: any) {
      // Non-critical — log and continue
      fastify.log.warn({ error: err.message }, 'Startup recoup check failed');
    }

    const updated = jobQueries.getById(id);
    return { data: formatJob(updated!) };
  });

  /**
   * POST /v1/jobs/:id/dispute
   * Open a dispute (buyer or seller)
   */
  fastify.post('/v1/jobs/:id/dispute', { preHandler: requireAuth }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const { id } = request.params as { id: string };

    // P2-DISPUTE-1: Require signature and reason for disputes
    const disputeSchema = z.object({
      reason: z.string().min(1).max(2000),
      timestamp: z.number(),
      signature: z.string().min(1),
    });

    const parsed = disputeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Dispute requires reason, timestamp, and signature', details: parsed.error.errors },
      });
    }

    const { reason, timestamp, signature } = parsed.data;

    const job = jobQueries.getById(id);
    if (!job) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Job not found' },
      });
    }

    // Either party can dispute
    if (job.buyer_verus_id !== session.verusId && job.seller_verus_id !== session.verusId) {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'Only job participants can open a dispute' },
      });
    }

    if (['completed', 'cancelled', 'disputed'].includes(job.status)) {
      return reply.code(400).send({
        error: { code: 'INVALID_STATUS', message: `Cannot dispute job in status: ${job.status}` },
      });
    }

    // Verify signature on dispute message
    const disputeMessage = `VAP-DISPUTE|Job:${job.job_hash}|Reason:${reason}|Ts:${timestamp}|I am raising a dispute on this job.`;

    const rpc = getRpcClient();
    let isValid: boolean;
    try {
      isValid = await rpc.verifyMessage(session.verusId, disputeMessage, signature);
    } catch {
      return reply.code(400).send({
        error: { code: 'VERIFICATION_FAILED', message: 'Could not verify signature' },
      });
    }

    if (!isValid) {
      return reply.code(401).send({
        error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed' },
      });
    }

    // P4-RACE-1: atomic update
    const success = jobQueries.setDisputed(id);
    if (!success) {
      return reply.code(409).send({
        error: { code: 'STATE_CONFLICT', message: 'Job was modified by another request' },
      });
    }

    // Record the dispute reason as a signed message
    jobMessageQueries.insert({
      job_id: id,
      sender_verus_id: session.verusId,
      content: `[DISPUTE] ${reason}`,
      signed: 1,
      signature,
      safety_score: null,
    });

    fastify.log.info({ jobId: id, disputedBy: session.verusId, reason }, 'Job disputed');
    const otherParty = session.verusId === job.buyer_verus_id ? job.seller_verus_id : job.buyer_verus_id;
    emitWebhookEvent({ type: 'job.disputed', agentVerusId: otherParty, jobId: id, data: { disputedBy: session.verusId, reason } });
    createNotification({ recipientVerusId: otherParty, type: 'job.disputed', title: 'Job Disputed', body: reason?.slice(0, 200) || 'A dispute has been raised on your job', jobId: id });

    const updatedJob = jobQueries.getById(id);
    return { data: formatJob(updatedJob!) };
  });

  /**
   * POST /v1/jobs/:id/cancel
   * Cancel a job (only if not yet accepted)
   */
  fastify.post('/v1/jobs/:id/cancel', { preHandler: requireAuth }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const { id } = request.params as { id: string };

    const job = jobQueries.getById(id);
    if (!job) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Job not found' },
      });
    }

    // Only buyer can cancel, and only before acceptance
    if (job.buyer_verus_id !== session.verusId) {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'Only the buyer can cancel this job' },
      });
    }

    if (job.status !== 'requested') {
      return reply.code(400).send({
        error: { code: 'INVALID_STATUS', message: 'Can only cancel jobs that have not been accepted' },
      });
    }

    // P4-RACE-1: atomic update
    const success = jobQueries.setCancelled(id);
    if (!success) {
      return reply.code(409).send({
        error: { code: 'STATE_CONFLICT', message: 'Job was modified by another request' },
      });
    }

    fastify.log.info({ jobId: id, buyer: session.verusId }, 'Job cancelled');
    emitWebhookEvent({ type: 'job.cancelled', agentVerusId: job.seller_verus_id, jobId: id, data: { cancelledBy: session.verusId } });
    createNotification({ recipientVerusId: job.seller_verus_id, type: 'job.cancelled', title: 'Job Cancelled', body: 'The job has been cancelled', jobId: id });

    const updatedJob = jobQueries.getById(id);
    return { data: formatJob(updatedJob!) };
  });

  // ==========================================
  // Job Messages
  // ==========================================

  /**
   * GET /v1/jobs/:id/messages
   * Get messages for a job
   */
  fastify.get('/v1/jobs/:id/messages', { preHandler: requireAuth }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, string>;

    const job = jobQueries.getById(id);
    if (!job) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Job not found' },
      });
    }

    // Only buyer or seller can view messages
    if (job.buyer_verus_id !== session.verusId && job.seller_verus_id !== session.verusId) {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'Not authorized to view this job' },
      });
    }

    const since = query.since;
    const limit = Math.min(parseInt(query.limit || '50', 10), 100);
    const offset = parseInt(query.offset || '0', 10);

    let messages;
    if (since) {
      messages = jobMessageQueries.getByJobIdSince(id, since, limit);
    } else {
      messages = jobMessageQueries.getByJobId(id, limit, offset);
    }
    const total = jobMessageQueries.countByJobId(id);

    return {
      data: messages.map((m: any) => ({
        id: m.id,
        senderVerusId: m.sender_verus_id,
        content: m.content,
        signed: m.signed === 1,
        signature: m.signature,
        safetyScore: m.safety_score,
        createdAt: m.created_at,
      })),
      meta: { total, limit, offset },
    };
  });

  /**
   * POST /v1/jobs/:id/messages
   * Send a message on a job
   */
  fastify.post('/v1/jobs/:id/messages', { preHandler: requireAuth }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const { id } = request.params as { id: string };

    const job = jobQueries.getById(id);
    if (!job) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Job not found' },
      });
    }

    // Only buyer or seller can send messages
    if (job.buyer_verus_id !== session.verusId && job.seller_verus_id !== session.verusId) {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'Not authorized on this job' },
      });
    }

    // P1-MSG-1: Rate limit messages
    if (!checkRateLimit(messageUserRateLimits, session.verusId, MAX_MESSAGES_PER_USER)) {
      return reply.code(429).send({
        error: { code: 'RATE_LIMITED', message: 'Too many messages. Please wait before sending more.' },
      });
    }
    if (!checkRateLimit(messageJobRateLimits, id, MAX_MESSAGES_PER_JOB)) {
      return reply.code(429).send({
        error: { code: 'RATE_LIMITED', message: 'Too many messages on this job. Please wait.' },
      });
    }

    // Parse message body
    const schema = z.object({
      content: z.string().min(1).max(4000),
      signature: z.string().optional(),
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid message', details: parsed.error.errors },
      });
    }

    // P1-MSG-2: Strip dangerous Unicode control characters
    const sanitizedContent = parsed.data.content
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '') // C0 controls (keep \n \r \t)
      .replace(/[\u200B-\u200F\u2028-\u2029\u202A-\u202E\u2060-\u2064\u2066-\u206F]/g, '') // zero-width, bidi overrides, invisible
      .replace(/[\uFFF0-\uFFFF]/g, '') // specials block
      .trim();

    if (!sanitizedContent) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Message content is empty after sanitization' },
      });
    }

    const content = sanitizedContent;
    const { signature } = parsed.data;

    // If signature provided, verify it
    let signed = 0;
    if (signature) {
      const rpc = getRpcClient();
      try {
        const isValid = await rpc.verifyMessage(session.verusId, content, signature);
        signed = isValid ? 1 : 0;
      } catch {
        // Signature verification failed, treat as unsigned
        signed = 0;
      }
    }

    const messageId = jobMessageQueries.insert({
      job_id: id,
      sender_verus_id: session.verusId,
      content,
      signed,
      signature: signature || null,
      safety_score: null,
    });

    fastify.log.info({ jobId: id, messageId, sender: session.verusId }, 'Job message sent');

    return {
      data: {
        id: messageId,
        senderVerusId: session.verusId,
        content,
        signed: signed === 1,
        signature: signature || null,
      },
    };
  });

  // ==========================================
  // Payment endpoints
  // ==========================================

  /**
   * POST /v1/jobs/:id/payment
   * Record payment transaction ID
   */
  fastify.post('/v1/jobs/:id/payment', { preHandler: requireAuth }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const { id } = request.params as { id: string };

    const job = jobQueries.getById(id);
    if (!job) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Job not found' },
      });
    }

    // Only buyer can record payment
    if (job.buyer_verus_id !== session.verusId) {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'Only the buyer can record payment' },
      });
    }

    const schema = z.object({
      txid: z.string().min(1).max(100).regex(/^[a-fA-F0-9]{64}$/, 'Invalid transaction hash format'),
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid payment data. txid must be a 64-character hex hash.' },
      });
    }

    const { txid } = parsed.data;

    // P1-PAY-1: Verify transaction exists on-chain
    const rpc = getRpcClient();
    let paymentVerified = 0;
    let verificationNote = '';

    try {
      const rawTx = await rpc.getTransaction(txid);
      
      if (!rawTx) {
        return reply.code(400).send({
          error: { code: 'TX_NOT_FOUND', message: 'Transaction not found on chain' },
        });
      }

      // Check confirmations (require at least 1, ideally 6+)
      const confirmations = rawTx.confirmations || 0;
      if (confirmations >= 6) {
        paymentVerified = 1;
        verificationNote = `Verified on-chain with ${confirmations} confirmations`;
      } else if (confirmations >= 1) {
        paymentVerified = 0; // Not fully verified yet
        verificationNote = `Found on-chain with ${confirmations} confirmations (needs 6+)`;
      } else {
        verificationNote = 'Transaction found but unconfirmed (0 confirmations)';
      }

      // Check if any output goes to the seller's payment address or identity address
      const sellerAddress = job.payment_address || job.seller_verus_id;
      let txAmount = 0;
      let foundRecipient = false;

      if (rawTx.vout) {
        for (const vout of rawTx.vout) {
          const addresses = vout.scriptPubKey?.addresses || [];
          if (addresses.includes(sellerAddress)) {
            txAmount += vout.value || 0;
            foundRecipient = true;
          }
        }
      }

      if (!foundRecipient) {
        fastify.log.warn({ jobId: id, txid, sellerAddress }, 'Payment txid does not pay seller address');
        // Still record it but don't verify — let seller check manually
        paymentVerified = 0;
        verificationNote = 'Transaction found but recipient does not match seller address';
      } else if (txAmount < job.amount) {
        paymentVerified = 0;
        verificationNote = `Transaction pays ${txAmount} ${job.currency} but job requires ${job.amount} ${job.currency}`;
      }

      fastify.log.info({ jobId: id, txid, confirmations, txAmount, foundRecipient, paymentVerified }, 'Payment verification result');
    } catch (rpcErr: any) {
      // Transaction not found or RPC error
      fastify.log.warn({ jobId: id, txid, error: rpcErr?.message }, 'Payment txid verification failed');
      paymentVerified = 0;
      verificationNote = 'Could not verify transaction on-chain';
    }

    // P2-LIVE-2: Wrap payment + status transition in transaction
    const db = getDatabase();
    db.transaction(() => {
      jobQueries.setPayment(id, txid, paymentVerified);
      // Only transition to in_progress if both payments are done
      const freshJob = jobQueries.getById(id)!;
      const bothPaid = freshJob.payment_txid && freshJob.platform_fee_txid;
      if (freshJob.status === 'accepted' && bothPaid) {
        db.prepare(`
          UPDATE jobs SET status = 'in_progress', updated_at = datetime('now') WHERE id = ? AND status = 'accepted'
        `).run(id);
      }
    })();

    const freshJob = jobQueries.getById(id)!;
    if (freshJob.status === 'in_progress') {
      fastify.log.info({ jobId: id }, 'Job moved to in_progress after both payments');
    }
    fastify.log.info({ jobId: id, txid, paymentVerified }, 'Agent payment recorded');
    emitWebhookEvent({ type: 'job.payment', agentVerusId: job.seller_verus_id, jobId: id, data: { txid, verified: paymentVerified === 1 } });
    createNotification({ recipientVerusId: job.seller_verus_id, type: 'job.payment', title: 'Payment Received', body: `Payment txid: ${txid.slice(0, 16)}...`, jobId: id });

    const updatedJob = jobQueries.getById(id);
    return { 
      data: formatJob(updatedJob!),
      meta: { verificationNote },
    };
  });

  /**
   * POST /v1/jobs/:id/platform-fee
   * Record platform fee (5%) transaction ID — paid to SafeChat address
   */
  fastify.post('/v1/jobs/:id/platform-fee', { preHandler: requireAuth }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const { id } = request.params as { id: string };

    const job = jobQueries.getById(id);
    if (!job) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
    }
    if (job.buyer_verus_id !== session.verusId) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Only the buyer can record platform fee' } });
    }

    const schema = z.object({
      txid: z.string().min(1).max(100).regex(/^[a-fA-F0-9]{64}$/, 'Invalid transaction hash format'),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid txid format' } });
    }

    const { txid } = parsed.data;
    const rpc = getRpcClient();
    const db = getDatabase();
    let feeVerified = 0;
    let verificationNote = '';

    try {
      const rawTx = await rpc.getTransaction(txid);
      if (!rawTx) {
        return reply.code(400).send({ error: { code: 'TX_NOT_FOUND', message: 'Transaction not found on chain' } });
      }

      const confirmations = rawTx.confirmations || 0;
      // Calculate discounted fee based on data terms
      const dt = db.prepare('SELECT * FROM job_data_terms WHERE job_id = ?').get(id) as any;
      const feeRate = calculateFeeRate(dt ? {
        allowTraining: dt?.allow_training === 1,
        allowThirdParty: dt?.allow_third_party === 1,
        requireDeletionAttestation: dt?.require_deletion_attestation === 1,
      } : undefined);
      const expectedFee = job.amount * feeRate;

      // Check if output goes to SafeChat fee address
      let feeAmount = 0;
      let foundRecipient = false;
      if (rawTx.vout) {
        for (const vout of rawTx.vout) {
          const addresses = vout.scriptPubKey?.addresses || [];
          if (addresses.includes(SAFECHAT_FEE_ADDRESS)) {
            feeAmount += vout.value || 0;
            foundRecipient = true;
          }
        }
      }

      if (!foundRecipient) {
        verificationNote = 'Transaction does not pay SafeChat fee address';
      } else if (feeAmount < expectedFee * 0.99) { // 1% tolerance for rounding
        verificationNote = `Fee amount ${feeAmount} is less than expected ${expectedFee}`;
      } else if (confirmations >= 6) {
        feeVerified = 1;
        verificationNote = `Verified with ${confirmations} confirmations`;
      } else {
        verificationNote = `Found with ${confirmations} confirmations (needs 6+)`;
      }

      fastify.log.info({ jobId: id, txid, feeAmount, expectedFee, feeVerified }, 'Platform fee verification');
    } catch (err: any) {
      fastify.log.warn({ jobId: id, txid, error: err?.message }, 'Platform fee verification failed');
      verificationNote = 'Could not verify transaction on-chain';
    }

    // Record fee and check if both payments are done
    db.transaction(() => {
      jobQueries.setPlatformFee(id, txid, feeVerified);
      const freshJob = jobQueries.getById(id)!;
      const bothPaid = freshJob.payment_txid && freshJob.platform_fee_txid;
      if (freshJob.status === 'accepted' && bothPaid) {
        db.prepare(`
          UPDATE jobs SET status = 'in_progress', updated_at = datetime('now') WHERE id = ? AND status = 'accepted'
        `).run(id);
      }
    })();

    const updatedJob = jobQueries.getById(id)!;
    if (updatedJob.status === 'in_progress') {
      fastify.log.info({ jobId: id }, 'Job moved to in_progress after both payments');
      emitWebhookEvent({ type: 'job.started', agentVerusId: job.seller_verus_id, jobId: id, data: {} });
      createNotification({ recipientVerusId: job.seller_verus_id, type: 'job.started', title: 'Job Started', body: 'Both payments received — job is now in progress', jobId: id });
    }

    return { data: formatJob(updatedJob), meta: { verificationNote } };
  });

  /**
   * POST /v1/jobs/:id/extensions
   * Request a session extension (additional payment for more work)
   */
  fastify.post('/v1/jobs/:id/extensions', { preHandler: requireAuth }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const { id } = request.params as { id: string };

    const job = jobQueries.getById(id);
    if (!job) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
    }
    if (job.status !== 'in_progress') {
      return reply.code(400).send({ error: { code: 'INVALID_STATE', message: 'Extensions only allowed for in-progress jobs' } });
    }
    const isBuyer = job.buyer_verus_id === session.verusId;
    const isSeller = job.seller_verus_id === session.verusId;
    if (!isBuyer && !isSeller) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Only job parties can request extensions' } });
    }

    const schema = z.object({
      amount: z.coerce.number().min(0.001),
      reason: z.string().max(1000).optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid extension data' } });
    }

    const extId = randomUUID();
    jobExtensionQueries.insert({
      id: extId,
      job_id: id,
      requester_verus_id: session.verusId,
      amount: parsed.data.amount,
      reason: parsed.data.reason,
    });

    // Notify the other party
    const recipientId = isBuyer ? job.seller_verus_id : job.buyer_verus_id;
    createNotification({
      recipientVerusId: recipientId,
      type: 'job.extension_request',
      title: 'Extension Requested',
      body: `Additional ${parsed.data.amount} ${job.currency} requested${parsed.data.reason ? ': ' + parsed.data.reason : ''}`,
      jobId: id,
    });
    emitWebhookEvent({ type: 'job.extension_request', agentVerusId: recipientId, jobId: id, data: { extensionId: extId, amount: parsed.data.amount } });

    return { data: { id: extId, jobId: id, amount: parsed.data.amount, reason: parsed.data.reason, status: 'pending' } };
  });

  /**
   * GET /v1/jobs/:id/extensions
   * Get all extensions for a job
   */
  fastify.get('/v1/jobs/:id/extensions', { preHandler: requireAuth }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const { id } = request.params as { id: string };

    const job = jobQueries.getById(id);
    if (!job) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
    }
    if (job.buyer_verus_id !== session.verusId && job.seller_verus_id !== session.verusId) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Not a party to this job' } });
    }

    const extensions = jobExtensionQueries.getByJobId(id);
    return {
      data: extensions.map(e => ({
        id: e.id,
        jobId: e.job_id,
        requester: e.requester_verus_id,
        amount: e.amount,
        reason: e.reason,
        status: e.status,
        agentTxid: e.agent_txid,
        feeTxid: e.fee_txid,
        createdAt: e.created_at,
      })),
    };
  });

  /**
   * POST /v1/jobs/:id/extensions/:extId/approve
   * Approve an extension request (other party)
   */
  fastify.post('/v1/jobs/:id/extensions/:extId/approve', { preHandler: requireAuth }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const { id, extId } = request.params as { id: string; extId: string };

    const job = jobQueries.getById(id);
    if (!job) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Job not found' } });

    const extensions = jobExtensionQueries.getByJobId(id);
    const ext = extensions.find(e => e.id === extId);
    if (!ext) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Extension not found' } });
    if (ext.status !== 'pending') return reply.code(400).send({ error: { code: 'INVALID_STATE', message: 'Extension is not pending' } });

    // Only the other party can approve
    if (ext.requester_verus_id === session.verusId) {
      return reply.code(400).send({ error: { code: 'INVALID_ACTION', message: 'Cannot approve your own extension request' } });
    }
    const isBuyer = job.buyer_verus_id === session.verusId;
    const isSeller = job.seller_verus_id === session.verusId;
    if (!isBuyer && !isSeller) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Not a party to this job' } });
    }

    jobExtensionQueries.updateStatus(extId, 'approved');

    createNotification({
      recipientVerusId: ext.requester_verus_id,
      type: 'job.extension_approved',
      title: 'Extension Approved',
      body: `Extension of ${ext.amount} ${job.currency} approved — please submit payment`,
      jobId: id,
    });

    return { data: { id: extId, status: 'approved' } };
  });

  /**
   * POST /v1/jobs/:id/extensions/:extId/payment
   * Record extension payment (agent payment txid)
   */
  fastify.post('/v1/jobs/:id/extensions/:extId/payment', { preHandler: requireAuth }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const { id, extId } = request.params as { id: string; extId: string };

    const job = jobQueries.getById(id);
    if (!job) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
    if (job.buyer_verus_id !== session.verusId) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Only the buyer can submit extension payment' } });
    }

    const extensions = jobExtensionQueries.getByJobId(id);
    const ext = extensions.find(e => e.id === extId);
    if (!ext) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Extension not found' } });
    if (ext.status !== 'approved') return reply.code(400).send({ error: { code: 'INVALID_STATE', message: 'Extension must be approved first' } });

    const schema = z.object({
      agentTxid: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
      feeTxid: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid txid format' } });
    }

    if (parsed.data.agentTxid) {
      jobExtensionQueries.setAgentPayment(extId, parsed.data.agentTxid, 0);
    }
    if (parsed.data.feeTxid) {
      jobExtensionQueries.setFeePayment(extId, parsed.data.feeTxid, 0);
    }

    // If both txids submitted, mark as paid and update job amount
    const updatedExt = jobExtensionQueries.getByJobId(id).find(e => e.id === extId)!;
    if (updatedExt.agent_txid && updatedExt.fee_txid) {
      jobExtensionQueries.updateStatus(extId, 'paid');
      // Add extension amount to job total
      const db = getDatabase();
      db.prepare(`UPDATE jobs SET amount = amount + ?, updated_at = datetime('now') WHERE id = ?`).run(ext.amount, id);

      createNotification({
        recipientVerusId: job.seller_verus_id,
        type: 'job.extension_paid',
        title: 'Extension Paid',
        body: `Additional ${ext.amount} ${job.currency} paid — session extended`,
        jobId: id,
      });
    }

    return { data: { id: extId, status: updatedExt.agent_txid && updatedExt.fee_txid ? 'paid' : 'approved' } };
  });

  /**
   * POST /v1/jobs/:id/extensions/:extId/reject
   * Reject an extension request
   */
  fastify.post('/v1/jobs/:id/extensions/:extId/reject', { preHandler: requireAuth }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const { id, extId } = request.params as { id: string; extId: string };

    const job = jobQueries.getById(id);
    if (!job) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Job not found' } });

    const extensions = jobExtensionQueries.getByJobId(id);
    const ext = extensions.find(e => e.id === extId);
    if (!ext) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Extension not found' } });
    if (ext.status !== 'pending') return reply.code(400).send({ error: { code: 'INVALID_STATE', message: 'Extension is not pending' } });

    if (ext.requester_verus_id === session.verusId) {
      return reply.code(400).send({ error: { code: 'INVALID_ACTION', message: 'Cannot reject your own extension request' } });
    }

    jobExtensionQueries.updateStatus(extId, 'rejected');

    createNotification({
      recipientVerusId: ext.requester_verus_id,
      type: 'job.extension_rejected',
      title: 'Extension Rejected',
      body: `Extension of ${ext.amount} ${job.currency} was rejected`,
      jobId: id,
    });

    return { data: { id: extId, status: 'rejected' } };
  });
}

/**
 * Format job for API response
 */
function formatJob(job: any) {
  return {
    id: job.id,
    jobHash: job.job_hash,
    buyerVerusId: job.buyer_verus_id,
    sellerVerusId: job.seller_verus_id,
    serviceId: job.service_id,
    description: job.description,
    amount: job.amount,
    currency: job.currency,
    deadline: job.deadline,
    status: job.status,
    safechatEnabled: job.safechat_enabled === 1,
    payment: (() => {
      // Look up data terms to calculate discounted fee
      const db = getDatabase();
      const dt = db.prepare('SELECT * FROM job_data_terms WHERE job_id = ?').get(job.id) as any;
      const feeRate = calculateFeeRate(dt ? {
        allowTraining: dt.allow_training === 1,
        allowThirdParty: dt.allow_third_party === 1,
        requireDeletionAttestation: dt.require_deletion_attestation === 1,
      } : undefined);
      return {
        terms: job.payment_terms || 'prepay',
        address: job.payment_address,
        txid: job.payment_txid,
        verified: job.payment_verified === 1,
        platformFeeTxid: job.platform_fee_txid,
        platformFeeVerified: job.platform_fee_verified === 1,
        platformFeeAddress: SAFECHAT_FEE_ADDRESS,
        feeRate,
        feeAmount: job.amount * feeRate,
      };
    })(),
    signatures: {
      request: job.request_signature,
      acceptance: job.acceptance_signature,
      delivery: job.delivery_signature,
      completion: job.completion_signature,
    },
    delivery: job.delivery_hash ? {
      hash: job.delivery_hash,
      message: job.delivery_message,
    } : null,
    timestamps: {
      requested: job.requested_at,
      accepted: job.accepted_at,
      delivered: job.delivered_at,
      completed: job.completed_at,
      created: job.created_at,
      updated: job.updated_at,
    },
  };
}
