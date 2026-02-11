/**
 * File Storage Manager (Phase 6b)
 * 
 * Local filesystem storage for job file attachments.
 * Files stored at: data/files/{jobId}/{fileId}-{filename}
 * 
 * Future: swap to S3-compatible backend via env config.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

const BASE_DIR = path.resolve('data', 'files');

// Allowed MIME types
const ALLOWED_MIME_TYPES = new Set([
  // Images (NO SVG — active scripting risk via <script>, onload, foreignObject)
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  // Documents (NO DOC/DOCX — macro injection, XML entity attacks)
  'application/pdf',
  'text/plain', 'text/markdown',
  'application/json', 'text/csv', 'application/xml', 'text/xml',
  // Code/archives
  'application/zip', 'application/gzip', 'application/x-tar',
  'application/x-gzip',
  // Design formats only — NOT a general catch-all
  'application/octet-stream', // Restricted to .psd, .ai, .fig extensions only
  'image/vnd.adobe.photoshop',
  'application/postscript',
]);

// Allowed extensions (secondary check)
// P1-FILE-1: Removed .svg (XSS), .doc/.docx (macro injection)
const ALLOWED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
  '.pdf', '.txt', '.md',
  '.zip', '.tar', '.gz', '.tgz',
  '.psd', '.ai', '.fig',
  '.json', '.csv', '.xml',
]);

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

// P1-FILE-2: Magic bytes for file type validation
const MAGIC_BYTES: Record<string, number[][]> = {
  '.png':  [[0x89, 0x50, 0x4E, 0x47]],
  '.jpg':  [[0xFF, 0xD8, 0xFF]],
  '.jpeg': [[0xFF, 0xD8, 0xFF]],
  '.gif':  [[0x47, 0x49, 0x46, 0x38]],
  '.webp': [[0x52, 0x49, 0x46, 0x46]], // RIFF header
  '.pdf':  [[0x25, 0x50, 0x44, 0x46]], // %PDF
  '.zip':  [[0x50, 0x4B, 0x03, 0x04], [0x50, 0x4B, 0x05, 0x06]], // PK
  '.gz':   [[0x1F, 0x8B]],
  '.tgz':  [[0x1F, 0x8B]],
  '.tar':  [[0x75, 0x73, 0x74, 0x61, 0x72]], // "ustar" at offset 257 — checked separately
};

/**
 * Validate magic bytes match claimed file extension
 */
function validateMagicBytes(buffer: Buffer, ext: string): boolean {
  const signatures = MAGIC_BYTES[ext];
  if (!signatures) return true; // No magic bytes defined = text/design files, skip

  // Special case: tar files have magic at offset 257
  if (ext === '.tar') {
    if (buffer.length < 262) return false;
    const tarMagic = buffer.slice(257, 262);
    return tarMagic.toString('ascii') === 'ustar';
  }

  for (const sig of signatures) {
    if (buffer.length < sig.length) continue;
    let match = true;
    for (let i = 0; i < sig.length; i++) {
      if (buffer[i] !== sig[i]) { match = false; break; }
    }
    if (match) return true;
  }
  return false;
}

export interface StoredFile {
  storagePath: string;
  checksum: string;
  sizeBytes: number;
}

/**
 * Validate file type by MIME and extension
 */
export function validateFileType(mimeType: string, filename: string): { valid: boolean; reason?: string } {
  const ext = path.extname(filename).toLowerCase();
  
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { valid: false, reason: `File extension "${ext}" is not allowed` };
  }

  // Allow application/octet-stream for design files
  if (mimeType === 'application/octet-stream') {
    const designExts = new Set(['.psd', '.ai', '.fig']);
    if (!designExts.has(ext)) {
      return { valid: false, reason: `Binary files only allowed for design formats (.psd, .ai, .fig)` };
    }
    return { valid: true };
  }

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return { valid: false, reason: `MIME type "${mimeType}" is not allowed` };
  }

  return { valid: true };
}

/**
 * Sanitize filename — strip path traversal, limit length
 */
export function sanitizeFilename(filename: string): string {
  // Remove path components
  let safe = path.basename(filename);
  // Remove null bytes and control chars
  safe = safe.replace(/[\x00-\x1f\x7f]/g, '');
  // Replace spaces and special chars
  safe = safe.replace(/[^a-zA-Z0-9._-]/g, '_');
  // Limit length (keep extension)
  const ext = path.extname(safe);
  const name = path.basename(safe, ext);
  if (name.length > 100) {
    safe = name.slice(0, 100) + ext;
  }
  return safe || 'unnamed';
}

/**
 * Store a file from a buffer
 */
export async function storeFile(
  jobId: string,
  fileId: string,
  filename: string,
  buffer: Buffer
): Promise<StoredFile> {
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${buffer.length} bytes (max ${MAX_FILE_SIZE})`);
  }

  // P2-FILE-5: Validate jobId is a UUID (prevent path traversal)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) {
    throw new Error('Invalid job ID format');
  }

  // P1-FILE-2: Validate magic bytes match extension
  const ext = path.extname(filename).toLowerCase();
  if (!validateMagicBytes(buffer, ext)) {
    throw new Error(`File content does not match extension "${ext}" (magic bytes mismatch)`);
  }

  const safeFilename = sanitizeFilename(filename);
  const jobDir = path.join(BASE_DIR, jobId);
  
  // P2-FILE-5: Double-check resolved path stays within BASE_DIR
  const resolvedJobDir = path.resolve(jobDir);
  if (!resolvedJobDir.startsWith(path.resolve(BASE_DIR))) {
    throw new Error('Invalid storage path');
  }

  // Ensure directory exists
  fs.mkdirSync(jobDir, { recursive: true });

  const storagePath = path.join(jobDir, `${fileId}-${safeFilename}`);
  
  // Calculate checksum
  const checksum = createHash('sha256').update(buffer).digest('hex');

  // Write file
  fs.writeFileSync(storagePath, buffer);

  return {
    storagePath,
    checksum,
    sizeBytes: buffer.length,
  };
}

/**
 * Read a file from storage
 */
export function readFile(storagePath: string): Buffer | null {
  // Prevent path traversal
  const resolved = path.resolve(storagePath);
  if (!resolved.startsWith(path.resolve(BASE_DIR))) {
    return null;
  }

  try {
    return fs.readFileSync(resolved);
  } catch {
    return null;
  }
}

/**
 * Delete a file from storage
 */
export function deleteFile(storagePath: string): boolean {
  const resolved = path.resolve(storagePath);
  if (!resolved.startsWith(path.resolve(BASE_DIR))) {
    return false;
  }

  try {
    fs.unlinkSync(resolved);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete all files for a job
 */
export function deleteJobFiles(jobId: string): number {
  const jobDir = path.join(BASE_DIR, jobId);
  if (!fs.existsSync(jobDir)) return 0;

  let count = 0;
  try {
    const files = fs.readdirSync(jobDir);
    for (const file of files) {
      fs.unlinkSync(path.join(jobDir, file));
      count++;
    }
    fs.rmdirSync(jobDir);
  } catch {
    // Best effort
  }
  return count;
}

/**
 * Get total storage used by a job (bytes)
 */
export function getJobStorageUsage(jobId: string): number {
  const jobDir = path.join(BASE_DIR, jobId);
  if (!fs.existsSync(jobDir)) return 0;

  let total = 0;
  try {
    const files = fs.readdirSync(jobDir);
    for (const file of files) {
      const stat = fs.statSync(path.join(jobDir, file));
      total += stat.size;
    }
  } catch {
    // Best effort
  }
  return total;
}

export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE;
