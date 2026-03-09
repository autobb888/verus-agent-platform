/**
 * SafeChat provider factory.
 * Returns a provider implementing both SafeChatScanFn and OutputScanFn interfaces,
 * or null if nothing is configured.
 *
 * Priority: HTTP API → Local module → null
 */
import { config } from '../config/index.js';
import { SafeChatHttpClient } from './client.js';
import { logger } from '../utils/logger.js';

export interface SafeChatProvider {
  scan(message: string): Promise<{ score: number; safe: boolean; classification: string; flags: string[] }>;
  scanOutput(message: string, context: {
    jobId: string;
    jobCategory?: string;
    agentVerusId?: string;
    whitelistedAddresses?: Set<string>;
  }): Promise<{
    safe: boolean;
    score: number;
    classification: string;
    flags: Array<{ type: string; severity: string; detail: string; action: string }>;
  }>;
}

export async function createSafeChatProvider(): Promise<SafeChatProvider | null> {
  const { apiUrl, apiKey, encryptionKey, path: safechatPath, timeoutMs } = config.safechat;

  // Mode 1: HTTP API (inbound via API, outbound via local module or fallback)
  if (apiKey && apiUrl) {
    const client = new SafeChatHttpClient({
      apiUrl,
      apiKey,
      encryptionKey: encryptionKey || undefined,
      timeoutMs,
      safechatPath,
    });
    const parts = ['http'];
    if (client.encrypted) parts.push('encrypted');
    parts.push('inbound + outbound');
    logger.info({ mode: parts.join(', ') }, 'SafeChat initialized');
    return client;
  }

  // Mode 2: Local module only
  if (safechatPath) {
    try {
      const mod = await import(safechatPath) as any;
      const engine = new mod.SafeChatEngine();
      logger.info({ mode: 'local, inbound + outbound' }, 'SafeChat initialized');
      return engine;
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'SafeChat local module failed to load');
    }
  }

  // Mode 3: Nothing configured
  logger.info('SafeChat not configured');
  return null;
}
