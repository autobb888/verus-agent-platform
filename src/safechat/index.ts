/**
 * SafeChat provider factory.
 * Returns a provider implementing both SafeChatScanFn and OutputScanFn interfaces,
 * or null if nothing is configured.
 *
 * Priority: HTTP API → Local module → null
 */
import { config } from '../config/index.js';
import { SafeChatHttpClient } from './client.js';

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
    console.log(`[Chat] SafeChat initialized (mode: ${parts.join(', ')})`);
    return client;
  }

  // Mode 2: Local module only
  if (safechatPath) {
    try {
      const mod = await import(safechatPath) as any;
      const engine = new mod.SafeChatEngine();
      console.log('[Chat] SafeChat initialized (mode: local, inbound + outbound)');
      return engine;
    } catch (err) {
      console.warn('[Chat] SafeChat local module failed to load:', (err as Error).message);
    }
  }

  // Mode 3: Nothing configured
  console.log('[Chat] SafeChat not configured');
  return null;
}
