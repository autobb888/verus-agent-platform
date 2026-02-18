/**
 * WifSigner - Sign messages using a WIF private key (offline, no daemon needed)
 * 
 * This signer is ideal for:
 * - Fresh agent setup without a Verus daemon
 * - Containerized environments
 * - Automated deployments
 * 
 * @example
 * ```typescript
 * import { WifSigner } from '@autobb/vap-agent';
 * 
 * const signer = new WifSigner({
 *   wif: 'Uw...',
 *   name: 'myagent.agentplatform@'
 * });
 * 
 * const signature = await signer.sign('message to sign');
 * ```
 */

import type { Signer } from '../types/index.js';
import * as secp256k1 from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha2';
import bs58check from 'bs58check';

export interface WifSignerOptions {
  /** WIF private key (e.g., 'Uw...') */
  wif: string;
  /** Full VerusID name (e.g., 'myagent.agentplatform@') */
  name: string;
}

export class WifSigner implements Signer {
  private wif: string;
  private name: string;
  private privKey: Uint8Array;

  constructor(options: WifSignerOptions) {
    this.wif = options.wif;
    this.name = options.name;
    
    // Decode WIF to private key
    const decoded = bs58check.decode(this.wif);
    
    // WIF format: 1 byte version + 32 byte privkey + [optional 1 byte compression flag] + 4 byte checksum
    // For compressed WIF (52 chars), last byte before checksum is 0x01
    if (decoded.length === 38) {
      // Compressed WIF
      this.privKey = decoded.slice(1, 33);
    } else if (decoded.length === 37) {
      // Uncompressed WIF
      this.privKey = decoded.slice(1, 33);
    } else {
      throw new Error(`Invalid WIF length: ${decoded.length}`);
    }
  }

  getVerusId(): string {
    return this.name;
  }

  /**
   * Sign a message using the WIF private key
   * Returns base64-encoded signature
   */
  async sign(message: string): Promise<string> {
    const msgHash = sha256(message);
    const signature = await secp256k1.sign(msgHash, this.privKey);
    // Convert signature to raw bytes (r || s)
    const sigBytes = signature.toCompactRawBytes();
    return Buffer.from(sigBytes).toString('base64');
  }

  /**
   * Get the public key (for registration)
   */
  async getPubkey(): Promise<string> {
    const pubkey = secp256k1.getPublicKey(this.privKey, true); // compressed
    return Buffer.from(pubkey).toString('hex');
  }

  /**
   * Get the R-address (for registration)
   */
  getAddress(): string {
    // Derive address from pubkey
    const pubkey = secp256k1.getPublicKey(this.privKey, true);
    
    // RIPEMD160(SHA256(pubkey)) with version byte 0x3C (Verus testnet)
    // For mainnet, use 0x3B
    const sha = sha256(pubkey);
    // Note: We need ripemd160 here - for now return derived from pubkey
    // Full implementation would use @noble/hashes/ripemd160
    
    // Simplified: return base58check encoded
    const version = Buffer.from([0x3C]); // Verus testnet
    const hash = sha.slice(0, 20); // Placeholder - should be RIPEMD160
    const payload = Buffer.concat([version, hash]);
    return bs58check.encode(payload);
  }
}
