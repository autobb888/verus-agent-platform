/**
 * Signer implementations for VerusID
 */

import type { Signer } from '../types/index.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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
    this.verusId = options.verusId;
    this.testnet = options.testnet ?? true;
    this.verusPath = options.verusPath ?? 'verus';
  }

  getVerusId(): string {
    return this.verusId;
  }

  async sign(message: string): Promise<string> {
    const networkFlag = this.testnet ? '-testnet' : '';
    const escapedMessage = message.replace(/"/g, '\\"').replace(/\n/g, '\\n');
    
    const command = `${this.verusPath} ${networkFlag} signmessage "${this.verusId}" "${escapedMessage}"`;
    
    try {
      const { stdout, stderr } = await execAsync(command);
      
      if (stderr) {
        throw new Error(`verus signmessage error: ${stderr}`);
      }
      
      // Parse the JSON response
      const result = JSON.parse(stdout.trim());
      
      if (result.signature) {
        return result.signature;
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
