/**
 * AES-256-GCM payload encryption for SafeChat HTTP API.
 * Matches SafeChat server-side format (src/crypto/encryption.ts).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface EncryptedPayload {
  iv: string;   // base64-encoded 12-byte IV
  tag: string;  // base64-encoded 16-byte GCM auth tag
  data: string; // base64-encoded ciphertext
}

const IV_BYTES = 12;
const ALGORITHM = 'aes-256-gcm';

export function encryptPayload(plaintext: string, key: Buffer): EncryptedPayload {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64'),
  };
}

export function decryptPayload(payload: EncryptedPayload, key: Buffer): string {
  if (!payload.iv || !payload.tag || !payload.data) {
    throw new Error('Missing required encryption fields');
  }
  const iv = Buffer.from(payload.iv, 'base64');
  if (iv.length !== IV_BYTES) throw new Error(`Invalid IV length: expected ${IV_BYTES}, got ${iv.length}`);
  const tag = Buffer.from(payload.tag, 'base64');
  if (tag.length !== 16) throw new Error(`Invalid auth tag length: expected 16, got ${tag.length}`);
  const data = Buffer.from(payload.data, 'base64');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
