import 'dotenv/config';

export const config = {
  verus: {
    rpcHost: process.env.VERUS_RPC_HOST || '127.0.0.1',
    rpcPort: parseInt(process.env.VERUS_RPC_PORT || '18843'),
    rpcUser: process.env.VERUS_RPC_USER || '',
    rpcPass: process.env.VERUS_RPC_PASS || '',
  },
  vdxf: {
    // Namespace root for agent VDXF keys (e.g., "ari" -> "ari::agent.v1.*")
    namespaceRoot: process.env.VDXF_NAMESPACE_ROOT || 'ari',
  },
  api: {
    port: parseInt(process.env.API_PORT || '3000'),
    host: process.env.API_HOST || '0.0.0.0',
  },
  rateLimit: {
    max: parseInt(process.env.RATE_LIMIT_MAX || '100'),
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
  },
  db: {
    path: process.env.DB_PATH || './data/verus-platform.db',
  },
  security: {
    webhookEncryptionKey: process.env.WEBHOOK_ENCRYPTION_KEY || '',
    cookieSecret: process.env.COOKIE_SECRET || '',
    corsOrigin: process.env.CORS_ORIGIN || '',
  },
  platform: {
    feeAddress: process.env.PLATFORM_FEE_ADDRESS || process.env.SAFECHAT_FEE_ADDRESS || 'RAWwNeTLRg9urgnDPQtPyZ6NRycsmSY2J2',
  },
  safechat: {
    apiUrl: process.env.SAFECHAT_API_URL || '',
    apiKey: process.env.SAFECHAT_API_KEY || '',
    encryptionKey: process.env.SAFECHAT_ENCRYPTION_KEY || '',
    path: process.env.SAFECHAT_PATH || '',
    timeoutMs: parseInt(process.env.SAFECHAT_TIMEOUT_MS || '200'),
  },
  indexer: {
    minConfirmations: parseInt(process.env.MIN_CONFIRMATIONS || '6'),
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '10000'),
    startBlock: parseInt(process.env.INDEXER_START_BLOCK || '0'),
  },
};
