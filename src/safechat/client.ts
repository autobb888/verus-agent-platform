/**
 * SafeChat HTTP API client.
 * Inbound scanning via POST /v1/scan with optional E2E encryption.
 * Outbound scanning delegates to local SafeChat module or fallback.
 */
import { encryptPayload, decryptPayload } from './crypto.js';
import * as fallback from './fallback.js';
import type { SafeChatProvider } from './index.js';

interface SafeChatClientConfig {
  apiUrl: string;
  apiKey: string;
  encryptionKey?: string;   // base64-encoded 256-bit key
  timeoutMs?: number;       // default 800
  safechatPath?: string;    // for local outbound scanning
}

// Circuit breaker state
interface CircuitBreaker {
  failures: number[];       // timestamps of recent failures
  openUntil: number;        // timestamp when circuit closes again
}

const CIRCUIT_FAILURE_WINDOW_MS = 60_000;
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_OPEN_DURATION_MS = 30_000;

export class SafeChatHttpClient implements SafeChatProvider {
  private apiUrl: string;
  private apiKey: string;
  private encryptionKey: Buffer | null;
  private timeoutMs: number;
  private safechatPath: string;
  private circuit: CircuitBreaker = { failures: [], openUntil: 0 };
  private localOutbound: any = null;
  private localOutboundLoaded = false;

  constructor(config: SafeChatClientConfig) {
    this.apiUrl = config.apiUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    if (config.encryptionKey) {
      const buf = Buffer.from(config.encryptionKey, 'base64');
      if (buf.length !== 32) {
        throw new Error(`SAFECHAT_ENCRYPTION_KEY must be 256 bits (32 bytes), got ${buf.length}`);
      }
      this.encryptionKey = buf;
    } else {
      this.encryptionKey = null;
    }
    this.timeoutMs = config.timeoutMs ?? 800;
    this.safechatPath = config.safechatPath || '';
  }

  get encrypted(): boolean {
    return this.encryptionKey !== null;
  }

  /**
   * Inbound scan: buyer→agent messages.
   * POST /v1/scan with optional AES-256-GCM encryption.
   * Falls back to inline regex scanner on timeout/error.
   */
  async scan(message: string): Promise<fallback.InboundScanResult> {
    if (this.isCircuitOpen()) {
      return fallback.scan(message);
    }

    try {
      const body = JSON.stringify({ text: message });
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      };

      let requestBody: string;
      if (this.encryptionKey) {
        const encrypted = encryptPayload(body, this.encryptionKey);
        requestBody = JSON.stringify(encrypted);
        headers['X-Encrypted'] = 'true';
      } else {
        requestBody = body;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(`${this.apiUrl}/v1/scan`, {
          method: 'POST',
          headers,
          body: requestBody,
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`SafeChat API ${response.status}: ${response.statusText}`);
        }

        let result: any;
        if (response.headers.get('x-encrypted') === 'true' && this.encryptionKey) {
          try {
            const encryptedResponse = await response.json();
            const decrypted = decryptPayload(encryptedResponse, this.encryptionKey);
            result = JSON.parse(decrypted);
          } catch (decryptErr) {
            throw new Error(`Decryption failed: ${decryptErr instanceof Error ? decryptErr.message : 'unknown'}`);
          }
        } else {
          result = await response.json();
        }

        this.recordSuccess();
        return {
          score: result.score ?? 0,
          safe: result.safe ?? true,
          classification: result.classification ?? 'safe',
          flags: result.flags ?? [],
        };
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      this.recordFailure();
      const reason = err instanceof Error ? err.name === 'AbortError' ? 'timeout' : err.message : 'unknown';
      console.warn(`[SafeChat] HTTP scan failed (${reason}), using fallback`);
      return fallback.scan(message);
    }
  }

  /**
   * Outbound scan: agent→buyer messages.
   * Always local — no HTTP endpoint for output scanning yet.
   * Tries dynamic import from SAFECHAT_PATH, falls back to inline scanner.
   */
  async scanOutput(
    message: string,
    context: {
      jobId: string;
      jobCategory?: string;
      agentVerusId?: string;
      whitelistedAddresses?: Set<string>;
    },
  ): Promise<fallback.OutputScanResult> {
    // Try loading local SafeChat outbound scanner once
    if (!this.localOutboundLoaded && this.safechatPath) {
      try {
        const mod = await import(this.safechatPath);
        if (mod.SafeChatEngine) {
          this.localOutbound = new mod.SafeChatEngine();
        }
      } catch {
        // Local module not available — will use fallback
      }
      this.localOutboundLoaded = true;
    }

    if (this.localOutbound?.scanOutput) {
      try {
        return await this.localOutbound.scanOutput(message, context);
      } catch {
        // Local outbound failed — fall through to inline
      }
    }

    return fallback.scanOutput(message, context);
  }

  // ── Circuit Breaker ──

  private isCircuitOpen(): boolean {
    if (Date.now() < this.circuit.openUntil) return true;
    // If we were open but time expired, reset
    if (this.circuit.openUntil > 0) {
      this.circuit = { failures: [], openUntil: 0 };
    }
    return false;
  }

  private recordFailure(): void {
    const now = Date.now();
    this.circuit.failures.push(now);
    // Keep only failures within the window
    const cutoff = now - CIRCUIT_FAILURE_WINDOW_MS;
    this.circuit.failures = this.circuit.failures.filter(t => t >= cutoff);

    if (this.circuit.failures.length >= CIRCUIT_FAILURE_THRESHOLD) {
      this.circuit.openUntil = now + CIRCUIT_OPEN_DURATION_MS;
      console.warn(`[SafeChat] Circuit breaker OPEN — ${CIRCUIT_FAILURE_THRESHOLD} failures in ${CIRCUIT_FAILURE_WINDOW_MS / 1000}s, fallback for ${CIRCUIT_OPEN_DURATION_MS / 1000}s`);
    }
  }

  private recordSuccess(): void {
    // Any success resets the failure count
    this.circuit.failures = [];
  }
}
