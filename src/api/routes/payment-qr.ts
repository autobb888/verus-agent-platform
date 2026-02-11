/**
 * VerusPay Invoice QR Generation
 * 
 * Generates proper VerusPay invoice QR codes that Verus Mobile natively understands.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { jobQueries } from '../../db/index.js';
import { getSessionFromRequest } from './auth.js';
// @ts-ignore — no type declarations
import BN from 'bn.js';

// Dynamic imports for verus-typescript-primitives (CommonJS)
let VerusPayInvoice: any;
let VerusPayInvoiceDetails: any;
let VERUSPAY_VALID: any;
let VERUSPAY_IS_TESTNET: any;
let TransferDestination: any;
let DEST_PKH: any;
let bs58check: any;

async function loadDeps() {
  if (VerusPayInvoice) return;
  
  const payInvoice = await import('verus-typescript-primitives/dist/vdxf/classes/payment/VerusPayInvoice.js');
  VerusPayInvoice = payInvoice.VerusPayInvoice;
  
  const payDetails = await import('verus-typescript-primitives/dist/vdxf/classes/payment/VerusPayInvoiceDetails.js');
  VerusPayInvoiceDetails = payDetails.VerusPayInvoiceDetails;
  VERUSPAY_VALID = payDetails.VERUSPAY_VALID;
  VERUSPAY_IS_TESTNET = payDetails.VERUSPAY_IS_TESTNET;
  
  const td = await import('verus-typescript-primitives/dist/pbaas/TransferDestination.js');
  TransferDestination = td.TransferDestination;
  DEST_PKH = td.DEST_PKH;
  
  // @ts-ignore — no type declarations
  bs58check = (await import('bs58check')).default;
}

// Verus system IDs
const VRSCTEST_SYSTEM = 'iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq';
const VRSC_SYSTEM = 'i5w5MuNik5NtLcYmNzcvaoixooEebB6MGV';

const SAFECHAT_FEE_ADDRESS = process.env.SAFECHAT_FEE_ADDRESS || 'RAWwNeTLRg9urgnDPQtPyZ6NRycsmSY2J2';
const IS_TESTNET = (process.env.CHAIN || 'VRSCTEST') === 'VRSCTEST';

function addressToPubkeyHash(address: string): Buffer {
  const decoded = bs58check.decode(address);
  return Buffer.from(decoded.slice(2)); // skip version bytes
}

function generateInvoice(address: string, amountVrsc: number, systemId: string, testnet: boolean): { qrString: string; deeplink: string } {
  const satoshis = Math.round(amountVrsc * 100000000);
  
  let flags = VERUSPAY_VALID;
  if (testnet) {
    flags = flags.or(VERUSPAY_IS_TESTNET);
  }
  
  const pubkeyHash = addressToPubkeyHash(address);
  
  const details = new VerusPayInvoiceDetails({
    flags,
    amount: new BN(satoshis),
    destination: new TransferDestination({
      type: DEST_PKH,
      destination_bytes: pubkeyHash,
    }),
    requestedcurrencyid: systemId,
  });
  
  const invoice = new VerusPayInvoice({
    details,
    system_id: systemId,
  });
  
  return {
    qrString: invoice.toQrString(),
    deeplink: invoice.toWalletDeeplinkUri(),
  };
}

// Auth middleware
async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
  }
  (request as any).session = session;
}

export async function paymentQrRoutes(fastify: FastifyInstance): Promise<void> {
  // Load dependencies on first request
  await loadDeps();

  /**
   * GET /v1/jobs/:id/payment-qr?type=agent|fee
   * Generate a VerusPay invoice QR for job payment
   */
  fastify.get('/v1/jobs/:id/payment-qr', { preHandler: requireAuth }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const { id } = request.params as { id: string };
    const { type = 'agent' } = request.query as { type?: string };

    if (!['agent', 'fee'].includes(type)) {
      return reply.code(400).send({ error: { code: 'INVALID_TYPE', message: 'type must be "agent" or "fee"' } });
    }

    const job = jobQueries.getById(id);
    if (!job) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
    }

    // Only buyer needs payment QR
    if (job.buyer_verus_id !== session.verusId) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Only the buyer can generate payment QR' } });
    }

    const systemId = IS_TESTNET ? VRSCTEST_SYSTEM : VRSC_SYSTEM;

    if (type === 'agent') {
      const address = job.payment_address || job.seller_verus_id;
      const invoice = generateInvoice(address, job.amount, systemId, IS_TESTNET);
      return {
        data: {
          type: 'agent',
          address,
          amount: job.amount,
          currency: job.currency,
          qrString: invoice.qrString,
          deeplink: invoice.deeplink,
        },
      };
    } else {
      const feeAmount = job.amount * 0.05;
      const invoice = generateInvoice(SAFECHAT_FEE_ADDRESS, feeAmount, systemId, IS_TESTNET);
      return {
        data: {
          type: 'fee',
          address: SAFECHAT_FEE_ADDRESS,
          amount: feeAmount,
          currency: job.currency,
          qrString: invoice.qrString,
          deeplink: invoice.deeplink,
        },
      };
    }
  });
}
