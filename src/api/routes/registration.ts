/**
 * Registration Routes
 * 
 * POST /v1/agents/register - Register a new agent (signed)
 * POST /v1/agents/:id/update - Update agent (signed)
 * POST /v1/agents/:id/deactivate - Deactivate agent (signed)
 * 
 * All endpoints require cryptographic signature verification.
 */

import { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/index.js';
import { verifySignedPayload, isValidVerusId } from '../../auth/signature.js';
import {
  RegistrationRequestSchema,
  UpdateRequestSchema,
  DeactivateRequestSchema,
  type RegistrationRequest,
  type AgentData,
} from '../../validation/registration-schema.js';
import { isReservedName } from '../../utils/reserved-names.js';
import { hasHomoglyphAttack } from '../../utils/homoglyph.js';
import { createVerification } from '../../worker/verification.js';

import { RateLimiter } from '../../utils/rate-limiter.js';

// Rate limiting state (per-IP and per-identity)
const ipLimiter = new RateLimiter(60 * 1000, 10);      // 10 req/min
const identityLimiter = new RateLimiter(60 * 1000, 5);  // 5 req/min

export async function registrationRoutes(fastify: FastifyInstance): Promise<void> {
  
  // POST /v1/agents/register - Register new agent
  fastify.post('/v1/agents/register', async (request, reply) => {
    const ip = request.ip;
    
    // Rate limiting (Shield AUTH-6)
    if (!ipLimiter.check(ip)) {
      return reply.code(429).send({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Try again later.',
        },
      });
    }
    
    // Get raw body for signature verification (before Zod adds defaults)
    const rawBody = request.body as any;
    
    // Parse and validate request body
    const parseResult = RegistrationRequestSchema.safeParse(request.body);
    
    if (!parseResult.success) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request format',
          details: parseResult.error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        },
      });
    }
    
    // Use parsed data for validation but raw data for signature verification
    const payload = parseResult.data;
    const rawPayload = {
      ...payload,
      data: rawBody.data,  // Use raw data without Zod defaults for hash computation
    };
    
    // Per-identity rate limiting
    if (!identityLimiter.check(payload.verusId)) {
      return reply.code(429).send({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many registration attempts for this identity.',
        },
      });
    }
    
    // Check reserved names
    if (isReservedName(payload.data.name)) {
      return reply.code(400).send({
        error: {
          code: 'RESERVED_NAME',
          message: `The name "${payload.data.name}" is reserved and cannot be used.`,
        },
      });
    }
    
    // Check homoglyph attacks
    const homoglyphCheck = hasHomoglyphAttack(payload.data.name);
    if (homoglyphCheck.isAttack) {
      return reply.code(400).send({
        error: {
          code: 'HOMOGLYPH_DETECTED',
          message: `Name contains suspicious characters that could be used for impersonation.`,
          details: {
            normalized: homoglyphCheck.normalized,
            suspicious: homoglyphCheck.confusedWith,
          },
        },
      });
    }
    
    // Verify signature using raw data (without Zod defaults that would change the hash)
    const verification = await verifySignedPayload(rawPayload);
    
    if (!verification.valid) {
      return reply.code(401).send({
        error: {
          code: 'SIGNATURE_INVALID',
          message: verification.error || 'Signature verification failed',
        },
      });
    }
    
    // Check if agent already exists
    const db = getDatabase();
    const existing = db.prepare('SELECT id FROM agents WHERE verus_id = ?').get(verification.identityAddress);
    
    if (existing) {
      return reply.code(409).send({
        error: {
          code: 'ALREADY_EXISTS',
          message: 'An agent with this VerusID is already registered. Use update instead.',
        },
      });
    }
    
    // Insert new agent
    const agentId = uuidv4();
    const now = new Date().toISOString();
    
    try {
      db.prepare(`
        INSERT INTO agents (
          id, verus_id, name, type, description, owner, status,
          block_height, block_hash, created_at, updated_at, indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'active', 0, 'api-registration', ?, ?, ?)
      `).run(
        agentId,
        verification.identityAddress,
        payload.data.name,
        payload.data.type,
        payload.data.description,
        payload.data.owner || verification.identityAddress,
        now,
        now,
        now
      );
      
      // Insert capabilities if provided
      if (payload.data.capabilities && payload.data.capabilities.length > 0) {
        const capStmt = db.prepare(`
          INSERT INTO agent_capabilities (
            id, agent_id, capability_id, name, description, protocol, endpoint, public
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        for (const cap of payload.data.capabilities) {
          capStmt.run(
            uuidv4(),
            agentId,
            cap.id,
            cap.name,
            cap.description || null,
            cap.protocol || null,
            cap.endpoint || null,
            cap.public ? 1 : 0
          );
        }
      }
      
      // Insert endpoints if provided and schedule verification
      if (payload.data.endpoints && payload.data.endpoints.length > 0) {
        const epStmt = db.prepare(`
          INSERT INTO agent_endpoints (id, agent_id, url, protocol, public)
          VALUES (?, ?, ?, ?, ?)
        `);
        
        for (const ep of payload.data.endpoints) {
          const endpointId = uuidv4();
          epStmt.run(
            endpointId,
            agentId,
            ep.url,
            ep.protocol,
            ep.public ? 1 : 0
          );
          
          // Schedule endpoint verification (Phase 2 Week 2)
          try {
            createVerification(endpointId, agentId, ep.url);
            fastify.log.info({ endpointId, url: ep.url }, 'Verification scheduled');
          } catch (err) {
            fastify.log.warn({ endpointId, url: ep.url, err }, 'Failed to schedule verification');
          }
        }
      }
      
      fastify.log.info({ verusId: payload.verusId, agentId }, 'Agent registered via API');
      
      return reply.code(201).send({
        data: {
          id: agentId,
          verusId: payload.verusId,
          identityAddress: verification.identityAddress,
          status: 'active',
          message: 'Agent registered successfully',
          endpointVerification: payload.data.endpoints?.length 
            ? 'Endpoint verification will begin shortly'
            : null,
        },
      });
      
    } catch (error) {
      fastify.log.error({ error, verusId: payload.verusId }, 'Failed to register agent');
      return reply.code(500).send({
        error: {
          code: 'REGISTRATION_FAILED',
          message: 'Failed to register agent. Please try again.',
        },
      });
    }
  });

  // POST /v1/agents/:id/update - Update existing agent
  fastify.post('/v1/agents/:id/update', async (request, reply) => {
    const ip = request.ip;
    const { id } = request.params as { id: string };
    
    // Rate limiting
    if (!ipLimiter.check(ip)) {
      return reply.code(429).send({
        error: { code: 'RATE_LIMITED', message: 'Too many requests.' },
      });
    }
    
    // Parse request
    const parseResult = UpdateRequestSchema.safeParse(request.body);
    
    if (!parseResult.success) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request format',
          details: parseResult.error.errors,
        },
      });
    }
    
    const payload = parseResult.data;
    
    // Verify signature
    const verification = await verifySignedPayload(payload);
    
    if (!verification.valid) {
      return reply.code(401).send({
        error: { code: 'SIGNATURE_INVALID', message: verification.error },
      });
    }
    
    // Find agent and verify ownership
    const db = getDatabase();
    const agent = db.prepare('SELECT * FROM agents WHERE verus_id = ?').get(id) as any;
    
    if (!agent) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Agent not found' },
      });
    }
    
    // Verify the signer owns this agent
    if (agent.verus_id !== verification.identityAddress && agent.owner !== verification.identityAddress) {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'Not authorized to update this agent' },
      });
    }
    
    // Build update query
    const updates: string[] = [];
    const values: any[] = [];
    
    if (payload.data.name) {
      // Check reserved names (Shield UPDATE-1 fix: also check homoglyphs)
      if (isReservedName(payload.data.name)) {
        return reply.code(400).send({
          error: { code: 'RESERVED_NAME', message: 'Name is reserved' },
        });
      }
      
      const homoglyphCheck = hasHomoglyphAttack(payload.data.name);
      if (homoglyphCheck.isAttack) {
        return reply.code(400).send({
          error: {
            code: 'HOMOGLYPH_DETECTED',
            message: 'Name contains suspicious characters that could be used for impersonation.',
            details: {
              normalized: homoglyphCheck.normalized,
              suspicious: homoglyphCheck.confusedWith,
            },
          },
        });
      }
      
      updates.push('name = ?');
      values.push(payload.data.name);
    }
    
    if (payload.data.type) {
      updates.push('type = ?');
      values.push(payload.data.type);
    }
    
    if (payload.data.description) {
      updates.push('description = ?');
      values.push(payload.data.description);
    }
    
    if (updates.length > 0) {
      updates.push('updated_at = ?');
      values.push(new Date().toISOString());
      values.push(agent.id);
      
      db.prepare(`UPDATE agents SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }
    
    return {
      data: {
        id: agent.id,
        message: 'Agent updated successfully',
      },
    };
  });

  // POST /v1/agents/:id/deactivate - Deactivate agent
  fastify.post('/v1/agents/:id/deactivate', async (request, reply) => {
    const ip = request.ip;
    const { id } = request.params as { id: string };
    
    // Stricter rate limiting for deactivation
    if (!ipLimiter.check(ip)) {
      return reply.code(429).send({
        error: { code: 'RATE_LIMITED', message: 'Too many requests.' },
      });
    }
    
    const parseResult = DeactivateRequestSchema.safeParse(request.body);
    
    if (!parseResult.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid request format' },
      });
    }
    
    const payload = parseResult.data;
    
    // Verify signature
    const verification = await verifySignedPayload(payload);
    
    if (!verification.valid) {
      return reply.code(401).send({
        error: { code: 'SIGNATURE_INVALID', message: verification.error },
      });
    }
    
    // Find and verify ownership
    const db = getDatabase();
    const agent = db.prepare('SELECT * FROM agents WHERE verus_id = ?').get(id) as any;
    
    if (!agent) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Agent not found' },
      });
    }
    
    if (agent.verus_id !== verification.identityAddress && agent.owner !== verification.identityAddress) {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'Not authorized to deactivate this agent' },
      });
    }
    
    // Deactivate
    db.prepare(`
      UPDATE agents SET status = 'inactive', revoked = 1, updated_at = ?
      WHERE id = ?
    `).run(new Date().toISOString(), agent.id);
    
    fastify.log.info({ verusId: payload.verusId, agentId: agent.id }, 'Agent deactivated');
    
    return {
      data: {
        id: agent.id,
        status: 'inactive',
        message: 'Agent deactivated successfully',
      },
    };
  });
}
