import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getRpcClient } from '../../indexer/rpc-client.js';
import { getSessionFromRequest } from './auth.js';

// ==========================================
// Auth middleware
// ==========================================

async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return reply.code(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  }
  (request as any).session = session;
}

// ==========================================
// Validation helpers
// ==========================================

const TXID_REGEX = /^[0-9a-fA-F]{64}$/;
const HEX_REGEX = /^[0-9a-fA-F]+$/;
const MAX_TX_SIZE = 100_000; // 100KB max raw tx hex (50KB decoded)

/**
 * Resolve the primary R-address for an authenticated session's identity.
 * Queries the Verus daemon to get the identity's primary address.
 */
async function resolveSessionAddress(session: { verusId: string }): Promise<string | null> {
  const rpc = getRpcClient();
  try {
    const identity = await rpc.getIdentity(session.verusId);
    if (identity?.identity?.primaryaddresses?.length > 0) {
      return identity.identity.primaryaddresses[0];
    }
    return null;
  } catch {
    return null;
  }
}

// ==========================================
// Route definitions
// ==========================================

export async function transactionRoutes(fastify: FastifyInstance): Promise<void> {
  const rpc = getRpcClient();

  // ------------------------------------------
  // GET /v1/tx/utxos
  // Returns spendable UTXOs for the authenticated session's own address.
  // No address parameter — derived from session identity. (P1-SDK-2)
  // ------------------------------------------
  fastify.get('/v1/tx/utxos', {
    preHandler: requireAuth,
    config: {
      rateLimit: { max: 30, timeWindow: 60_000 },
    },
  }, async (request, reply) => {
    const session = (request as any).session;
    
    const address = await resolveSessionAddress(session);
    if (!address) {
      return reply.code(404).send({
        error: { code: 'ADDRESS_NOT_FOUND', message: 'Could not resolve primary address for your identity' },
      });
    }

    try {
      const utxos = await rpc.rpcCall<Array<{
        address: string;
        txid: string;
        outputIndex: number;
        satoshis: number;
        height: number;
      }>>('getaddressutxos', [{ addresses: [address] }]);

      return reply.send({
        address,
        utxos: (utxos || []).map(u => ({
          txid: u.txid,
          vout: u.outputIndex,
          satoshis: u.satoshis,
          height: u.height,
        })),
        count: (utxos || []).length,
      });
    } catch (error: any) {
      console.error('[TX] getaddressutxos error:', error.message);
      return reply.code(502).send({
        error: { code: 'RPC_ERROR', message: 'Failed to fetch UTXOs from chain' },
      });
    }
  });

  // ------------------------------------------
  // GET /v1/tx/info
  // Returns current chain info: block height, chain name, version.
  // Public endpoint — no auth required.
  // ------------------------------------------
  fastify.get('/v1/tx/info', {
    config: {
      rateLimit: { max: 60, timeWindow: 60_000 },
    },
  }, async (_request, reply) => {
    try {
      const info = await rpc.rpcCall<{
        version: number;
        protocolversion: number;
        blocks: number;
        longestchain: number;
        connections: number;
        difficulty: number;
        chainid: string;
        name: string;
        testnet: boolean;
        paytxfee: number;
        relayfee: number;
      }>('getinfo');

      return reply.send({
        chain: info.name,
        testnet: info.testnet,
        blockHeight: info.blocks,
        longestChain: info.longestchain,
        connections: info.connections,
        version: info.version,
        protocolVersion: info.protocolversion,
        relayFee: info.relayfee,
        payTxFee: info.paytxfee,
      });
    } catch (error: any) {
      console.error('[TX] getinfo error:', error.message);
      return reply.code(502).send({
        error: { code: 'RPC_ERROR', message: 'Failed to fetch chain info' },
      });
    }
  });

  // ------------------------------------------
  // POST /v1/tx/broadcast
  // Broadcasts a signed raw transaction to the network.
  // Decodes TX server-side to verify platform address involvement. (P2-SDK-3)
  // ------------------------------------------
  fastify.post('/v1/tx/broadcast', {
    preHandler: requireAuth,
    config: {
      rateLimit: { max: 10, timeWindow: 60_000 },
    },
  }, async (request, reply) => {
    const session = (request as any).session;
    const { rawhex } = request.body as { rawhex?: string };

    // Validate input
    if (!rawhex || typeof rawhex !== 'string') {
      return reply.code(400).send({
        error: { code: 'INVALID_INPUT', message: 'rawhex is required' },
      });
    }

    if (!HEX_REGEX.test(rawhex)) {
      return reply.code(400).send({
        error: { code: 'INVALID_HEX', message: 'rawhex must be valid hexadecimal' },
      });
    }

    if (rawhex.length > MAX_TX_SIZE * 2) {
      return reply.code(400).send({
        error: { code: 'TX_TOO_LARGE', message: `Transaction exceeds maximum size of ${MAX_TX_SIZE} bytes` },
      });
    }

    // Decode the transaction to verify platform involvement (P2-SDK-3)
    let decodedTx: any;
    try {
      decodedTx = await rpc.rpcCall('decoderawtransaction', [rawhex]);
    } catch (error: any) {
      return reply.code(400).send({
        error: { code: 'DECODE_FAILED', message: 'Could not decode transaction — invalid format' },
      });
    }

    // Resolve the session's primary address
    const sessionAddress = await resolveSessionAddress(session);
    if (!sessionAddress) {
      return reply.code(404).send({
        error: { code: 'ADDRESS_NOT_FOUND', message: 'Could not resolve your primary address' },
      });
    }

    // P2-SDK-11: Verify at least one input belongs to the session's address
    // Look up input UTXOs to check the spending addresses
    let sessionOwnsInput = false;
    const inputAddresses: string[] = [];

    for (const vin of decodedTx.vin || []) {
      if (!vin.txid || vin.vout === undefined) continue; // coinbase or malformed
      try {
        const prevTx = await rpc.rpcCall<{
          vout: Array<{ scriptPubKey: { addresses?: string[] } }>;
        }>('getrawtransaction', [vin.txid, 1]);
        
        const prevOutput = prevTx?.vout?.[vin.vout];
        const addrs = prevOutput?.scriptPubKey?.addresses || [];
        inputAddresses.push(...addrs);

        if (addrs.includes(sessionAddress)) {
          sessionOwnsInput = true;
        }
      } catch {
        // Can't look up input — skip (may be unconfirmed)
      }
    }

    if (!sessionOwnsInput) {
      console.warn(`[TX] Broadcast REJECTED — no input matches session address ${sessionAddress}. Input addrs: [${inputAddresses.join(', ')}]`);
      return reply.code(403).send({
        error: { code: 'NOT_YOUR_TX', message: 'Transaction must spend from your registered address' },
      });
    }

    // Collect output info for audit
    const outputAddresses: string[] = [];
    for (const vout of decodedTx.vout || []) {
      const addrs = vout.scriptPubKey?.addresses || [];
      outputAddresses.push(...addrs);
    }

    // Calculate total output + input values for fee guard
    const totalOutput = (decodedTx.vout || []).reduce(
      (sum: number, v: any) => sum + (v.value || 0), 0
    );

    // Fee guard: warn if outputs seem unreasonably large (> 1000 VRSC)
    if (totalOutput > 1000) {
      console.warn(`[TX] Large transaction from ${session.verusId}: ${totalOutput} VRSC total output`);
    }

    // Audit log
    console.log(`[TX] Broadcast from ${session.verusId} (${sessionAddress}): inputs from [${inputAddresses.join(', ')}], outputs to [${outputAddresses.join(', ')}], total: ${totalOutput} VRSC`);

    // Broadcast
    try {
      const txid = await rpc.rpcCall<string>('sendrawtransaction', [rawhex]);
      
      console.log(`[TX] Broadcast success: ${txid} from ${session.verusId}`);
      
      return reply.send({
        txid,
        status: 'broadcast',
      });
    } catch (error: any) {
      console.error(`[TX] Broadcast failed for ${session.verusId}:`, error.message);
      
      // Parse common RPC errors
      if (error.message.includes('missing inputs') || error.message.includes('bad-txns')) {
        return reply.code(400).send({
          error: { code: 'TX_REJECTED', message: 'Transaction rejected: invalid inputs or double-spend' },
        });
      }
      if (error.message.includes('insufficient fee') || error.message.includes('min relay fee')) {
        return reply.code(400).send({
          error: { code: 'INSUFFICIENT_FEE', message: 'Transaction fee too low' },
        });
      }

      return reply.code(502).send({
        error: { code: 'BROADCAST_FAILED', message: 'Failed to broadcast transaction' },
      });
    }
  });

  // ------------------------------------------
  // GET /v1/tx/status/:txid
  // Returns transaction status and confirmation count.
  // ------------------------------------------
  fastify.get('/v1/tx/status/:txid', {
    preHandler: requireAuth,
    config: {
      rateLimit: { max: 30, timeWindow: 60_000 },
    },
  }, async (request, reply) => {
    const { txid } = request.params as { txid: string };

    if (!txid || !TXID_REGEX.test(txid)) {
      return reply.code(400).send({
        error: { code: 'INVALID_TXID', message: 'txid must be a 64-character hex string' },
      });
    }

    try {
      const tx = await rpc.rpcCall<{
        txid: string;
        blockhash?: string;
        confirmations?: number;
        time?: number;
        blocktime?: number;
        vout?: Array<{ value: number; scriptPubKey: { addresses?: string[] } }>;
      }>('getrawtransaction', [txid, 1]);

      return reply.send({
        txid: tx.txid,
        confirmations: tx.confirmations || 0,
        blockHash: tx.blockhash || null,
        blockTime: tx.blocktime || null,
        timestamp: tx.time || null,
        confirmed: (tx.confirmations || 0) > 0,
      });
    } catch (error: any) {
      // TX not found in mempool or chain
      if (error.message.includes('No information available')) {
        return reply.code(404).send({
          error: { code: 'TX_NOT_FOUND', message: 'Transaction not found' },
        });
      }

      console.error('[TX] getrawtransaction error:', error.message);
      return reply.code(502).send({
        error: { code: 'RPC_ERROR', message: 'Failed to fetch transaction status' },
      });
    }
  });
}
