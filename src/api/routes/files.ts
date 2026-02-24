/**
 * Job File Sharing API (Phase 6b)
 * 
 * Upload and download files attached to jobs.
 * Files are tied to jobs — only buyer/seller can access.
 * 
 * Endpoints:
 * - POST   /v1/jobs/:id/files     — Upload a file
 * - GET    /v1/jobs/:id/files      — List files for a job
 * - GET    /v1/jobs/:id/files/:fid — Download a file
 * - DELETE /v1/jobs/:id/files/:fid — Delete a file (uploader only)
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { jobQueries, jobFileQueries, jobMessageQueries } from '../../db/index.js';
import { getSessionFromRequest } from './auth.js';
import { getIO } from '../../chat/ws-server.js';
import { emitWebhookEvent } from '../../notifications/webhook-engine.js';
import {
  validateFileType,
  sanitizeFilename,
  storeFile,
  readFile,
  deleteFile as deleteStoredFile,
  getJobStorageUsage,
  MAX_FILE_SIZE_BYTES,
} from '../../files/storage.js';

const MAX_FILES_PER_JOB = 50;
const MAX_STORAGE_PER_JOB = 100 * 1024 * 1024; // 100MB total per job

import { RateLimiter } from '../../utils/rate-limiter.js';

// Rate limiting for uploads
const uploadLimiter = new RateLimiter(60 * 1000, 10); // 10 uploads/min

async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return reply.code(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  }
  (request as any).session = session;
}

function isJobParticipant(job: any, verusId: string): boolean {
  return job.buyer_verus_id === verusId || job.seller_verus_id === verusId;
}

export async function fileRoutes(fastify: FastifyInstance): Promise<void> {

  /**
   * POST /v1/jobs/:id/files
   * Upload a file to a job
   */
  fastify.post('/v1/jobs/:id/files', { preHandler: requireAuth }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const { id: jobId } = request.params as { id: string };

    // Rate limit
    if (!uploadLimiter.check(session.verusId)) {
      return reply.code(429).send({
        error: { code: 'RATE_LIMITED', message: 'Too many uploads. Please wait.' },
      });
    }

    // Get job
    const job = jobQueries.getById(jobId);
    if (!job) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Job not found' },
      });
    }

    // Auth: must be buyer or seller
    if (!isJobParticipant(job, session.verusId)) {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'Not authorized on this job' },
      });
    }

    // Job must be in active state
    if (['completed', 'cancelled'].includes(job.status)) {
      return reply.code(400).send({
        error: { code: 'JOB_CLOSED', message: 'Cannot upload files to a completed or cancelled job' },
      });
    }

    // Check file count limit
    const existingCount = jobFileQueries.countByJobId(jobId);
    if (existingCount >= MAX_FILES_PER_JOB) {
      return reply.code(400).send({
        error: { code: 'FILE_LIMIT', message: `Maximum ${MAX_FILES_PER_JOB} files per job` },
      });
    }

    // Check storage limit
    const currentUsage = getJobStorageUsage(jobId);
    if (currentUsage >= MAX_STORAGE_PER_JOB) {
      return reply.code(400).send({
        error: { code: 'STORAGE_LIMIT', message: 'Job storage limit reached (100MB)' },
      });
    }

    // Parse multipart
    let file;
    try {
      file = await request.file();
    } catch (err) {
      return reply.code(400).send({
        error: { code: 'INVALID_UPLOAD', message: 'Expected multipart file upload' },
      });
    }

    if (!file) {
      return reply.code(400).send({
        error: { code: 'NO_FILE', message: 'No file provided' },
      });
    }

    // Validate file type
    const typeCheck = validateFileType(file.mimetype, file.filename);
    if (!typeCheck.valid) {
      return reply.code(400).send({
        error: { code: 'INVALID_FILE_TYPE', message: typeCheck.reason },
      });
    }

    // Read file buffer (with size limit)
    const chunks: Buffer[] = [];
    let totalSize = 0;

    try {
      for await (const chunk of file.file) {
        totalSize += chunk.length;
        if (totalSize > MAX_FILE_SIZE_BYTES) {
          return reply.code(400).send({
            error: { code: 'FILE_TOO_LARGE', message: `File exceeds ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB limit` },
          });
        }
        chunks.push(chunk);
      }
    } catch (err) {
      return reply.code(400).send({
        error: { code: 'UPLOAD_ERROR', message: 'Error reading uploaded file' },
      });
    }

    // Check if stream was truncated (fastify/multipart truncates at limit)
    if (file.file.truncated) {
      return reply.code(400).send({
        error: { code: 'FILE_TOO_LARGE', message: `File exceeds size limit` },
      });
    }

    const buffer = Buffer.concat(chunks);
    const safeFilename = sanitizeFilename(file.filename);

    // SafeChat: Scan file content for injection patterns (GAP-5)
    // Extracts text from scannable file types and runs regex scan
    const textMimeTypes = ['text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/xml', 'text/xml'];
    if (textMimeTypes.includes(file.mimetype)) {
      try {
        const extractedText = buffer.slice(0, 100 * 1024).toString('utf-8');
        if (extractedText.trim().length > 0) {
          // Dynamic import to avoid cross-project TS resolution issues
          // SafeChat will be a proper npm package once published
          const safechatPath = new URL('../../../safechat/src/scanner/regex.js', import.meta.url).pathname;
          const { regexScan } = await import(/* @vite-ignore */ safechatPath);
          const contentResult = regexScan(extractedText);
          if (contentResult.score >= 0.5) {
            fastify.log.warn({
              jobId, filename: safeFilename, mimeType: file.mimetype,
              score: contentResult.score, flags: contentResult.flags,
            }, 'File content flagged by SafeChat');
            return reply.code(400).send({
              error: { code: 'CONTENT_FLAGGED', message: 'File content flagged by safety filter' },
            });
          }
        }
      } catch (scanErr) {
        // SafeChat not available — continue without content scanning
        fastify.log.debug({ err: scanErr }, 'File content scanning skipped');
      }
    }

    // Generate file ID and store
    const { randomUUID } = await import('crypto');
    const fileId = randomUUID();

    let stored;
    try {
      stored = await storeFile(jobId, fileId, safeFilename, buffer);
    } catch (err: any) {
      fastify.log.error({ err, jobId, fileId }, 'File storage failed');
      return reply.code(500).send({
        error: { code: 'STORAGE_ERROR', message: 'Failed to store file' },
      });
    }

    // Save to DB
    jobFileQueries.insert({
      id: fileId,
      job_id: jobId,
      message_id: null,
      uploader_verus_id: session.verusId,
      filename: safeFilename,
      mime_type: file.mimetype,
      size_bytes: stored.sizeBytes,
      storage_path: stored.storagePath,
      checksum: stored.checksum,
    });

    // Auto-create a system message about the file upload
    const messageId = jobMessageQueries.insert({
      job_id: jobId,
      sender_verus_id: session.verusId,
      content: `📎 Uploaded file: ${safeFilename} (${formatSize(stored.sizeBytes)})`,
      signed: 0,
      signature: null,
      safety_score: null,
    });

    // Link file to message
    jobFileQueries.setMessageId(fileId, messageId);

    fastify.log.info({
      jobId, fileId, filename: safeFilename,
      size: stored.sizeBytes, checksum: stored.checksum,
      uploader: session.verusId,
    }, 'File uploaded');

    // Broadcast file upload event to job room via Socket.IO
    const io = getIO();
    if (io) {
      io.to(`job:${jobId}`).emit('file_uploaded', {
        id: fileId,
        jobId,
        messageId,
        uploaderVerusId: session.verusId,
        filename: safeFilename,
        mimeType: file.mimetype,
        sizeBytes: stored.sizeBytes,
        downloadUrl: `/v1/jobs/${jobId}/files/${fileId}`,
      });
    }

    // Notify the other party via webhook
    const recipient = session.verusId === job.buyer_verus_id ? job.seller_verus_id : job.buyer_verus_id;
    emitWebhookEvent({
      type: 'file.uploaded',
      agentVerusId: recipient,
      jobId,
      data: { uploaderVerusId: session.verusId, filename: safeFilename, sizeBytes: stored.sizeBytes },
    });

    return reply.code(201).send({
      data: {
        id: fileId,
        jobId,
        messageId,
        uploaderVerusId: session.verusId,
        filename: safeFilename,
        mimeType: file.mimetype,
        sizeBytes: stored.sizeBytes,
        checksum: stored.checksum,
        createdAt: new Date().toISOString(),
        downloadUrl: `/v1/jobs/${jobId}/files/${fileId}`,
      },
    });
  });

  /**
   * GET /v1/jobs/:id/files
   * List all files for a job
   */
  fastify.get('/v1/jobs/:id/files', { preHandler: requireAuth }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const { id: jobId } = request.params as { id: string };

    const job = jobQueries.getById(jobId);
    if (!job) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Job not found' },
      });
    }

    if (!isJobParticipant(job, session.verusId)) {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'Not authorized on this job' },
      });
    }

    const files = jobFileQueries.getByJobId(jobId);
    const totalStorage = getJobStorageUsage(jobId);

    return {
      data: files.map(f => ({
        id: f.id,
        jobId: f.job_id,
        messageId: f.message_id,
        uploaderVerusId: f.uploader_verus_id,
        filename: f.filename,
        mimeType: f.mime_type,
        sizeBytes: f.size_bytes,
        checksum: f.checksum,
        createdAt: f.created_at,
        downloadUrl: `/v1/jobs/${jobId}/files/${f.id}`,
      })),
      meta: {
        count: files.length,
        maxFiles: MAX_FILES_PER_JOB,
        totalStorageBytes: totalStorage,
        maxStorageBytes: MAX_STORAGE_PER_JOB,
      },
    };
  });

  /**
   * GET /v1/jobs/:id/files/:fid
   * Download a file
   */
  fastify.get('/v1/jobs/:id/files/:fid', { preHandler: requireAuth }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const { id: jobId, fid: fileId } = request.params as { id: string; fid: string };

    const job = jobQueries.getById(jobId);
    if (!job) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Job not found' },
      });
    }

    if (!isJobParticipant(job, session.verusId)) {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'Not authorized on this job' },
      });
    }

    const fileRecord = jobFileQueries.getById(fileId);
    if (!fileRecord || fileRecord.job_id !== jobId) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'File not found' },
      });
    }

    const buffer = readFile(fileRecord.storage_path);
    if (!buffer) {
      return reply.code(404).send({
        error: { code: 'FILE_MISSING', message: 'File not found on storage' },
      });
    }

    // P2-FILE-4: Sanitize filename for Content-Disposition header injection
    const safeName = fileRecord.filename.replace(/["\r\n]/g, '_');
    
    // Set content headers
    reply.header('Content-Type', fileRecord.mime_type);
    reply.header('Content-Disposition', `attachment; filename="${safeName}"`);
    reply.header('Content-Length', fileRecord.size_bytes);
    reply.header('X-Checksum-SHA256', fileRecord.checksum);
    
    // P2-FILE-3: Prevent content-sniffing and script execution
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Security-Policy', "default-src 'none'");
    
    // Cache for 1 hour (files are immutable)
    reply.header('Cache-Control', 'private, max-age=3600');

    return reply.send(buffer);
  });

  /**
   * DELETE /v1/jobs/:id/files/:fid
   * Delete a file (uploader only)
   */
  fastify.delete('/v1/jobs/:id/files/:fid', { preHandler: requireAuth }, async (request, reply) => {
    const session = (request as any).session as { verusId: string };
    const { id: jobId, fid: fileId } = request.params as { id: string; fid: string };

    const job = jobQueries.getById(jobId);
    if (!job) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Job not found' },
      });
    }

    const fileRecord = jobFileQueries.getById(fileId);
    if (!fileRecord || fileRecord.job_id !== jobId) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'File not found' },
      });
    }

    // Only uploader can delete
    if (fileRecord.uploader_verus_id !== session.verusId) {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'Only the uploader can delete this file' },
      });
    }

    // Delete from storage
    deleteStoredFile(fileRecord.storage_path);
    
    // Delete from DB
    jobFileQueries.delete(fileId);

    fastify.log.info({ jobId, fileId, uploader: session.verusId }, 'File deleted');

    return { data: { deleted: true } };
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
