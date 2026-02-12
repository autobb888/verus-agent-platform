/**
 * Profile endpoint — returns the authenticated user's on-chain VerusID identity
 * with decoded contentmultimap using agentplatform DefinedKey labels.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getSessionFromRequest } from './auth.js';
import { getRpcClient } from '../../indexer/rpc-client.js';
import { VDXF_KEYS, parseVdxfValue } from '../../validation/vdxf-keys.js';

async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
  }
  return session;
}

// Build reverse lookup: i-address → { schema, field, definedKeyName }
const REVERSE_LOOKUP: Record<string, { schema: string; field: string; definedKeyName: string }> = {};
for (const [schema, keys] of Object.entries(VDXF_KEYS)) {
  for (const [field, iAddress] of Object.entries(keys)) {
    REVERSE_LOOKUP[iAddress] = {
      schema,
      field,
      definedKeyName: `agentplatform::${schema === 'agent' ? 'agent' : schema === 'service' ? 'svc' : schema === 'review' ? 'review' : 'platform'}.v1.${field}`,
    };
  }
}

function decodeContentMultimap(cmm: Record<string, unknown[]> | undefined): Record<string, unknown> {
  if (!cmm) return {};
  const decoded: Record<string, unknown> = {};

  for (const [iAddress, values] of Object.entries(cmm)) {
    const lookup = REVERSE_LOOKUP[iAddress];
    const label = lookup
      ? `${lookup.definedKeyName} (${lookup.schema}.${lookup.field})`
      : iAddress;

    const decodedValues = (values as string[]).map(v => {
      try {
        return parseVdxfValue(v);
      } catch {
        return v;
      }
    });

    decoded[label] = decodedValues.length === 1 ? decodedValues[0] : decodedValues;
  }

  return decoded;
}

function decodeContentMap(cm: Record<string, string> | undefined): Record<string, unknown> {
  if (!cm) return {};
  const decoded: Record<string, unknown> = {};

  for (const [iAddress, value] of Object.entries(cm)) {
    const lookup = REVERSE_LOOKUP[iAddress];
    const label = lookup
      ? `${lookup.definedKeyName} (${lookup.schema}.${lookup.field})`
      : iAddress;

    try {
      decoded[label] = parseVdxfValue(value);
    } catch {
      decoded[label] = value;
    }
  }

  return decoded;
}

export async function profileRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/v1/me/identity', { preHandler: requireAuth }, async (request, reply) => {
    const session = getSessionFromRequest(request)!;

    try {
      const rpc = getRpcClient();
      const raw = await rpc.getIdentity(session.verusId) as any;

      const identity = raw.identity || raw;
      const fqn = raw.fullyqualifiedname || identity.name;

      // Decode contentmultimap and contentmap with agentplatform DefinedKey labels
      const decodedContentMultimap = decodeContentMultimap(identity.contentmultimap);
      const decodedContentMap = decodeContentMap(identity.contentmap);

      return {
        data: {
          // Core identity fields
          fullyqualifiedname: fqn,
          iAddress: identity.identityaddress || session.verusId,
          version: identity.version,
          flags: identity.flags,
          minimumsignatures: identity.minimumsignatures,
          primaryaddresses: identity.primaryaddresses,
          recoveryauthority: identity.recoveryauthority,
          revocationauthority: identity.revocationauthority,
          timelock: identity.timelock,
          parent: identity.parent,

          // Raw on-chain data
          contentmultimap: identity.contentmultimap || {},
          contentmap: identity.contentmap || {},

          // Human-readable decoded data using agentplatform DefinedKeys
          decoded: {
            contentmultimap: decodedContentMultimap,
            contentmap: decodedContentMap,
          },

          // DefinedKey reference
          schema: {
            agent: Object.entries(VDXF_KEYS.agent).map(([field, addr]) => ({
              field,
              iAddress: addr,
              definedKey: `agentplatform::agent.v1.${field}`,
            })),
            service: Object.entries(VDXF_KEYS.service).map(([field, addr]) => ({
              field,
              iAddress: addr,
              definedKey: `agentplatform::svc.v1.${field}`,
            })),
            review: Object.entries(VDXF_KEYS.review).map(([field, addr]) => ({
              field,
              iAddress: addr,
              definedKey: `agentplatform::review.v1.${field}`,
            })),
            platform: Object.entries(VDXF_KEYS.platform).map(([field, addr]) => ({
              field,
              iAddress: addr,
              definedKey: `agentplatform::platform.v1.${field}`,
            })),
          },

          // Warnings for the agent/user
          warnings: (() => {
            const w: { code: string; severity: string; message: string; hint?: string }[] = [];
            const iAddr = identity.identityaddress || session.verusId;

            // Empty profile
            const cmmKeys = Object.keys(identity.contentmultimap || {}).length;
            const cmKeys = Object.keys(identity.contentmap || {}).length;
            if (cmmKeys === 0 && cmKeys === 0) {
              w.push({
                code: 'EMPTY_PROFILE',
                severity: 'warning',
                message: 'Your contentmultimap is empty. Nobody can see what you offer. Publish agent data with updateidentity.',
                hint: 'See GET /v1/me/identity → schema for the agentplatform DefinedKeys to use.',
              });
            }

            // Self-referencing revocation
            if (identity.revocationauthority === iAddr) {
              w.push({
                code: 'SELF_REVOCATION',
                severity: 'critical',
                message: 'Revocation authority points to your own identity. If your keys are compromised, you cannot revoke your ID. Set it to a separate VerusID you control.',
                hint: `updateidentity '{"name":"${identity.name}","parent":"${identity.parent}","revocationauthority":"YOUR_BACKUP_ID@"}'`,
              });
            }

            // Self-referencing recovery
            if (identity.recoveryauthority === iAddr) {
              w.push({
                code: 'SELF_RECOVERY',
                severity: 'critical',
                message: 'Recovery authority points to your own identity. If your keys are lost, you cannot recover your ID. Set it to a separate VerusID you control.',
                hint: `updateidentity '{"name":"${identity.name}","parent":"${identity.parent}","recoveryauthority":"YOUR_BACKUP_ID@"}'`,
              });
            }

            // No private address
            if (!identity.privateaddress) {
              w.push({
                code: 'NO_PRIVATE_ADDRESS',
                severity: 'info',
                message: 'No private (z) address set. Add one for shielded transactions.',
                hint: 'Generate with z_getnewaddress, then updateidentity with privateaddress field.',
              });
            }

            return w;
          })(),

          // updateidentity hint
          updateHint: `verus -chain=vrsctest updateidentity '${JSON.stringify({
            name: fqn?.replace(/@$/, '') || session.verusId,
            parent: identity.parent,
            contentmultimap: { '...vdxf_key_iaddress...': ['...hex_encoded_value...'] },
          })}'`,
        },
      };
    } catch (err: any) {
      return reply.code(502).send({
        error: { code: 'RPC_ERROR', message: err.message || 'Failed to fetch identity from chain' },
      });
    }
  });
}
