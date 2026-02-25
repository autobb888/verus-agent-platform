import 'dotenv/config';

/** Parse int with fallback: returns defaultVal on NaN or non-finite results */
function safeInt(raw: string | undefined, defaultVal: number, min = 0): number {
  const n = parseInt(raw || String(defaultVal), 10);
  return Number.isFinite(n) && n >= min ? n : defaultVal;
}

export const config = {
  verus: {
    rpcHost: process.env.VERUS_RPC_HOST || '127.0.0.1',
    rpcPort: safeInt(process.env.VERUS_RPC_PORT, 18843, 1),
    rpcUser: process.env.VERUS_RPC_USER || '',
    rpcPass: process.env.VERUS_RPC_PASS || '',
  },
  vdxf: {
    // Namespace root for agent VDXF keys (e.g., "ari" -> "ari::agent.v1.*")
    namespaceRoot: process.env.VDXF_NAMESPACE_ROOT || 'ari',
  },
  api: {
    port: safeInt(process.env.API_PORT, 3000, 1),
    host: process.env.API_HOST || '0.0.0.0',
  },
  rateLimit: {
    max: Math.max(1, safeInt(process.env.RATE_LIMIT_MAX, 100, 1)),
    windowMs: safeInt(process.env.RATE_LIMIT_WINDOW_MS, 60000, 1000),
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
    timeoutMs: safeInt(process.env.SAFECHAT_TIMEOUT_MS, 200, 50),
  },
  indexer: {
    minConfirmations: safeInt(process.env.MIN_CONFIRMATIONS, 6, 0),
    pollIntervalMs: safeInt(process.env.POLL_INTERVAL_MS, 10000, 1000),
    startBlock: safeInt(process.env.INDEXER_START_BLOCK, 0, 0),
  },
};
