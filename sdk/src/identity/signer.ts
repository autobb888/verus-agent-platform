/**
 * Signer implementations for VerusID
 */

import type { Signer } from '../types/index.js';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// VerusID format: alphanumeric, dots, hyphens, underscores, ending with @
const VERUS_ID_PATTERN = /^[a-zA-Z0-9._-]+@$/;
// Safe path pattern: no shell metacharacters
const SAFE_PATH_PATTERN = /^[a-zA-Z0-9_./-]+$/;

/**
 * CLI Signer - uses `verus signmessage` command
 * Requires verus CLI to be installed and wallet unlocked
 */
export class CliSigner implements Signer {
  private verusId: string;
  private testnet: boolean;
  private verusPath: string;

  constructor(options: {
    verusId: string;
    testnet?: boolean;
    verusPath?: string;
  }) {
    if (!VERUS_ID_PATTERN.test(options.verusId)) {
      throw new Error('Invalid verusId format');
    }
    const verusPath = options.verusPath ?? 'verus';
    if (!SAFE_PATH_PATTERN.test(verusPath)) {
      throw new Error('Invalid verusPath: contains disallowed characters');
    }
    this.verusId = options.verusId;
    this.testnet = options.testnet ?? true;
    this.verusPath = verusPath;
  }

  getVerusId(): string {
    return this.verusId;
  }

  async sign(message: string): Promise<string> {
    const args: string[] = [];
    if (this.testnet) args.push('-testnet');
    args.push('signmessage', this.verusId, message);

    try {
      const { stdout, stderr } = await execFileAsync(this.verusPath, args);

      if (stderr) {
        throw new Error('verus signmessage failed');
      }

      let result: unknown;
      try {
        result = JSON.parse(stdout.trim());
      } catch {
        throw new Error('Invalid JSON response from verus CLI');
      }

      if (result && typeof result === 'object' && 'signature' in result && typeof (result as Record<string, unknown>).signature === 'string') {
        return (result as Record<string, unknown>).signature as string;
      }

      throw new Error('No signature in response');
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to sign message: ${error.message}`);
      }
      throw error;
    }
  }
}

/**
 * Callback Signer - uses a custom signing function
 * Useful for browser wallets or external signing services
 */
export class CallbackSigner implements Signer {
  constructor(
    private verusId: string,
    private signFn: (message: string) => Promise<string>
  ) {}

  getVerusId(): string {
    return this.verusId;
  }

  async sign(message: string): Promise<string> {
    return this.signFn(message);
  }
}

/**
 * Manual Signer - for testing or when signature is provided externally
 * Does not actually sign - throws if sign() is called
 */
export class ManualSigner implements Signer {
  constructor(private verusId: string) {}

  getVerusId(): string {
    return this.verusId;
  }

  async sign(_message: string): Promise<string> {
    throw new Error(
      'ManualSigner does not support signing. ' +
      'Use submitSigned() or loginWithSignature() with a pre-signed value.'
    );
  }
}
