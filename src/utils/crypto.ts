/**
 * Symmetric encryption for webhook secrets at rest.
 * Uses AES-256-GCM with random IV per encryption.
 * 
 * Key: WEBHOOK_ENCRYPTION_KEY env var (32-byte hex = 64 chars)
 * If no key is set, falls back to plaintext (dev mode).
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { config } from '../config/index.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer | null {
  const hex = config.security.webhookEncryptionKey;
  if (!hex || hex.length !== 64) return null;
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypt a plaintext secret. Returns `enc:<iv>:<authTag>:<ciphertext>` (all hex).
 * If no encryption key is configured, returns plaintext as-is.
 */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  if (!key) return plaintext;

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `enc:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a secret. Handles both encrypted (`enc:...`) and legacy plaintext values.
 */
export function decryptSecret(stored: string): string {
  if (!stored.startsWith('enc:')) return stored; // Legacy plaintext

  const key = getKey();
  if (!key) throw new Error('WEBHOOK_ENCRYPTION_KEY required to decrypt webhook secrets');

  const parts = stored.split(':');
  if (parts.length !== 4) throw new Error('Invalid encrypted secret format');

  const iv = Buffer.from(parts[1], 'hex');
  const authTag = Buffer.from(parts[2], 'hex');
  const ciphertext = Buffer.from(parts[3], 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}
