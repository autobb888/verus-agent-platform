/**
 * WebSocket Chat Server (Phase 6)
 * 
 * Socket.IO server for real-time job messaging.
 * Auth: session cookie or one-time token.
 * Rooms: job:{jobId}
 */

import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import { getDatabase } from '../db/index.js';
import { jobQueries, jobMessageQueries, chatTokenQueries, readReceiptQueries } from '../db/index.js';
import { parse as parseCookie } from 'cookie';

// Types
interface AuthenticatedSocket extends Socket {
  verusId: string;
  sessionValidatedAt: number;
}

interface SafeChatScanFn {
  scan(message: string): Promise<{ score: number; safe: boolean; classification: string; flags: string[] }>;
}

// Phase 6c: Output scanning for agent responses (reverse SafeChat)
interface OutputScanFn {
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

let outputScanEngine: OutputScanFn | null = null;

export function setOutputScanEngine(engine: OutputScanFn): void {
  outputScanEngine = engine;
}

// Connection tracking
const ipConnections = new Map<string, number>();
const userConnections = new Map<string, number>();
const MAX_CONNECTIONS_PER_IP = 10;
const MAX_CONNECTIONS_PER_USER = 5;
const SESSION_REVALIDATION_MS = 60 * 1000;
const MAX_MESSAGE_SIZE = 16 * 1024; // 16KB

// Circuit breaker: agent-to-agent flood detection
interface RoomMessageTracker {
  messages: Array<{ sender: string; timestamp: number }>;
  paused: boolean;
}
const roomTrackers = new Map<string, RoomMessageTracker>();
const CIRCUIT_BREAKER_WINDOW_MS = 60 * 1000;
const CIRCUIT_BREAKER_THRESHOLD = 20;

// Multi-turn session scorer (crescendo attack detection)
// Inline to avoid cross-project import issues. Canonical source: ~/safechat/src/scanner/session-scorer.ts
class SessionScorer {
  private sessions = new Map<string, Array<{ score: number; timestamp: number }>>();
  private accessOrder: string[] = [];
  constructor(private opts: { windowSize: number; sumThreshold: number; minFlaggedForEscalation: number; maxAgeMs: number; maxSessions?: number }) {}
  record(sessionId: string, score: number) {
    const now = Date.now();
    let scores = this.sessions.get(sessionId);
    if (!scores) { scores = []; this.sessions.set(sessionId, scores); }
    scores.push({ score, timestamp: now });
    const cutoff = now - this.opts.maxAgeMs;
    const windowed = scores.filter(s => s.timestamp >= cutoff).slice(-this.opts.windowSize);
    this.sessions.set(sessionId, windowed);
    // LRU
    const idx = this.accessOrder.indexOf(sessionId);
    if (idx !== -1) this.accessOrder.splice(idx, 1);
    this.accessOrder.push(sessionId);
    const max = this.opts.maxSessions ?? 10000;
    while (this.sessions.size > max && this.accessOrder.length > 0) {
      this.sessions.delete(this.accessOrder.shift()!);
    }
    const rollingSum = windowed.reduce((s, e) => s + e.score, 0);
    const flaggedCount = windowed.filter(e => e.score > 0.3).length;
    return {
      escalated: rollingSum >= this.opts.sumThreshold && flaggedCount >= this.opts.minFlaggedForEscalation,
      rollingSum: Math.round(rollingSum * 1000) / 1000,
      windowSize: windowed.length,
      flaggedCount,
    };
  }
}
const sessionScorer = new SessionScorer({
  windowSize: 10,
  sumThreshold: 2.0,
  minFlaggedForEscalation: 3,
  maxAgeMs: 3600000, // 1 hour
});

let ioInstance: SocketIOServer | null = null;
let safechatEngine: SafeChatScanFn | null = null;

export function getIO(): SocketIOServer | null {
  return ioInstance;
}

export function setSafeChatEngine(engine: SafeChatScanFn): void {
  safechatEngine = engine;
}

function getSessionFromCookie(cookieHeader: string | undefined): { verusId: string } | null {
  if (!cookieHeader) return null;
  const cookies = parseCookie(cookieHeader);
  const sessionId = cookies['verus_session'];
  if (!sessionId) return null;

  try {
    const db = getDatabase();
    const session = db.prepare(`
      SELECT verus_id, expires_at FROM sessions WHERE id = ?
    `).get(sessionId) as { verus_id: string; expires_at: number } | undefined;

    if (!session || session.expires_at < Date.now()) return null;
    return { verusId: session.verus_id };
  } catch {
    return null;
  }
}

function getSessionFromToken(token: string | undefined): { verusId: string } | null {
  if (!token) return null;
  const consumed = chatTokenQueries.consume(token);
  if (!consumed) return null;
  return { verusId: consumed.verus_id };
}

function checkCircuitBreaker(room: string, sender: string): { allowed: boolean; paused: boolean } {
  let tracker = roomTrackers.get(room);
  if (!tracker) {
    tracker = { messages: [], paused: false };
    roomTrackers.set(room, tracker);
  }

  if (tracker.paused) return { allowed: false, paused: true };

  const now = Date.now();
  // Prune old messages
  tracker.messages = tracker.messages.filter(m => now - m.timestamp < CIRCUIT_BREAKER_WINDOW_MS);
  tracker.messages.push({ sender, timestamp: now });

  if (tracker.messages.length >= CIRCUIT_BREAKER_THRESHOLD) {
    // Check if all messages are from exactly 2 senders (agent-to-agent)
    const senders = new Set(tracker.messages.map(m => m.sender));
    if (senders.size <= 2) {
      tracker.paused = true;
      return { allowed: false, paused: true };
    }
  }

  return { allowed: true, paused: false };
}

export function initSocketServer(httpServer: HttpServer): SocketIOServer {
  ioInstance = new SocketIOServer(httpServer, {
    path: '/ws',
    cors: {
      origin: process.env.CORS_ORIGIN || false,
      credentials: true,
    },
    maxHttpBufferSize: MAX_MESSAGE_SIZE,
  });

  const io = ioInstance;

  // Auth middleware
  io.use((socket, next) => {
    const ip = socket.handshake.address;

    // Connection limit per IP
    const ipCount = ipConnections.get(ip) || 0;
    if (ipCount >= MAX_CONNECTIONS_PER_IP) {
      return next(new Error('Too many connections from this IP'));
    }

    // Try cookie auth first, then token
    let session = getSessionFromCookie(socket.handshake.headers.cookie);
    if (!session) {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      session = getSessionFromToken(token as string);
    }

    if (!session) {
      return next(new Error('Authentication required'));
    }

    // Connection limit per user
    const userCount = userConnections.get(session.verusId) || 0;
    if (userCount >= MAX_CONNECTIONS_PER_USER) {
      return next(new Error('Too many connections for this user'));
    }

    (socket as AuthenticatedSocket).verusId = session.verusId;
    (socket as AuthenticatedSocket).sessionValidatedAt = Date.now();
    next();
  });

  io.on('connection', (rawSocket) => {
    const socket = rawSocket as AuthenticatedSocket;
    const ip = socket.handshake.address;

    // Track connections
    ipConnections.set(ip, (ipConnections.get(ip) || 0) + 1);
    userConnections.set(socket.verusId, (userConnections.get(socket.verusId) || 0) + 1);

    // Session revalidation interval
    const revalidateInterval = setInterval(() => {
      const session = getSessionFromCookie(socket.handshake.headers.cookie);
      if (!session) {
        socket.emit('error', { message: 'Session expired' });
        socket.disconnect(true);
      } else {
        socket.sessionValidatedAt = Date.now();
      }
    }, SESSION_REVALIDATION_MS);

    // Join a job room
    socket.on('join_job', (data: { jobId: string }) => {
      const { jobId } = data;
      if (!jobId || typeof jobId !== 'string') return;

      const job = jobQueries.getById(jobId);
      if (!job) {
        socket.emit('error', { message: 'Job not found' });
        return;
      }

      // Verify user is buyer or seller
      if (job.buyer_verus_id !== socket.verusId && job.seller_verus_id !== socket.verusId) {
        socket.emit('error', { message: 'Not authorized for this job' });
        return;
      }

      const room = `job:${jobId}`;
      socket.join(room);
      socket.emit('joined', { jobId, room });
    });

    // Leave a job room
    socket.on('leave_job', (data: { jobId: string }) => {
      if (data?.jobId) {
        socket.leave(`job:${data.jobId}`);
      }
    });

    // Send message
    socket.on('message', async (data: { jobId: string; content: string; signature?: string }) => {
      const { jobId, content, signature } = data || {};
      if (!jobId || !content || typeof content !== 'string') {
        socket.emit('error', { message: 'Invalid message data' });
        return;
      }

      if (content.length > 4000) {
        socket.emit('error', { message: 'Message too long (max 4000 chars)' });
        return;
      }

      const room = `job:${jobId}`;
      if (!socket.rooms.has(room)) {
        socket.emit('error', { message: 'Not in this job room' });
        return;
      }

      // Circuit breaker check
      const cbResult = checkCircuitBreaker(room, socket.verusId);
      if (!cbResult.allowed) {
        if (cbResult.paused) {
          // Insert system message
          jobMessageQueries.insert({
            job_id: jobId,
            sender_verus_id: 'system',
            content: 'Chat paused: unusual activity detected',
            signed: 0,
            signature: null,
            safety_score: null,
          });
          io.to(room).emit('message', {
            id: 'system',
            senderVerusId: 'system',
            content: 'Chat paused: unusual activity detected',
            signed: false,
            safetyScore: null,
            createdAt: new Date().toISOString(),
          });
        }
        socket.emit('error', { message: 'Chat paused due to unusual activity' });
        return;
      }

      // Sanitize
      const sanitized = content
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
        .replace(/[\u200B-\u200F\u2028-\u2029\u202A-\u202E\u2060-\u2064\u2066-\u206F]/g, '')
        .replace(/[\uFFF0-\uFFFF]/g, '')
        .trim();

      if (!sanitized) {
        socket.emit('error', { message: 'Empty message after sanitization' });
        return;
      }

      // SafeChat scan
      let safetyScore: number | null = null;
      let safetyWarning = false;
      if (safechatEngine) {
        try {
          const result = await safechatEngine.scan(sanitized);
          safetyScore = result.score;
          if (result.score > 0.8) {
            socket.emit('error', { message: 'Message blocked by safety filter' });
            return;
          }
          if (result.score >= 0.4) {
            safetyWarning = true;
          }

          // Multi-turn scoring: track rolling scores per session to detect crescendo attacks
          // Session key = sender + job (so each user-in-job gets their own window)
          const sessionKey = `${socket.verusId}:${jobId}`;
          const escalation = sessionScorer.record(sessionKey, result.score);
          if (escalation.escalated) {
            console.log(`[SafeChat] Crescendo escalation detected: session=${sessionKey} rollingSum=${escalation.rollingSum} flagged=${escalation.flaggedCount}`);
            socket.emit('error', { message: 'Messages blocked: unusual pattern detected. Please contact support.' });
            return;
          }
        } catch {
          // Continue without safety score if scan fails
        }
      }

      // Phase 6c: Output scanning (reverse SafeChat) — scan agent→buyer messages
      // Shield: Don't tell agents which scanner flagged them (oracle prevention)
      let outputBlocked = false;
      let outputWarning = false;
      if (outputScanEngine) {
        const job = jobQueries.getById(jobId);
        // Only scan messages FROM seller (agent) TO buyer
        if (job && socket.verusId === job.seller_verus_id) {
          try {
            // P2-OUT-3: Whitelist job's own payment address
            const whitelistedAddresses = new Set<string>();
            if (job.payment_address) whitelistedAddresses.add(job.payment_address);
            if (job.seller_verus_id) whitelistedAddresses.add(job.seller_verus_id);

            const outResult = await outputScanEngine.scanOutput(sanitized, {
              jobId,
              agentVerusId: socket.verusId,
              whitelistedAddresses,
            });

            // Check for registered canary token leaks
            try {
              const canaryDb = getDatabase();
              const canaryCheck = canaryDb.prepare(
                `SELECT token FROM agent_canaries WHERE verus_id = ?`
              ).all(socket.verusId) as { token: string }[];
              
              for (const { token } of canaryCheck) {
                if (sanitized.includes(token)) {
                  console.warn(`[Canary] LEAK DETECTED for ${socket.verusId} in job ${jobId}`);
                  outResult.score = 1.0;
                  const canaryFlag = { type: 'canary_leak', severity: 'critical', detail: 'Registered canary token found in outbound message', action: 'hold' };
                  if (Array.isArray(outResult.flags)) {
                    outResult.flags.push(canaryFlag);
                  } else {
                    (outResult as any).flags = [canaryFlag];
                  }
                  break;
                }
              }
            } catch (canaryErr) {
              // Don't block message if canary check fails
              console.error('[Canary] Lookup error:', canaryErr);
            }
            // Use output score if higher than inbound score
            if (outResult.score > (safetyScore || 0)) {
              safetyScore = outResult.score;
            }
            if (outResult.score >= 0.6) {
              // Block — hold message for review
              const { holdMessage } = await import('./hold-queue.js');
              holdMessage({
                jobId,
                senderVerusId: socket.verusId,
                content: sanitized,
                safetyScore: outResult.score,
                flags: outResult.flags,
              });
              // Shield: Agent sees generic "held for review" — not which scanner triggered
              socket.emit('message_held', { jobId, message: 'Message held for review' });
              
              // Create alert for buyer
              const { createAlert } = await import('../api/routes/alerts.js');
              const blockFlag = outResult.flags[0];
              if (blockFlag) {
                createAlert({
                  jobId,
                  buyerVerusId: job.buyer_verus_id,
                  agentVerusId: socket.verusId,
                  type: blockFlag.type as any,
                  severity: outResult.score >= 0.8 ? 'critical' : 'warning',
                  title: 'Message flagged by SafeChat',
                  detail: blockFlag.detail,
                  suggestedAction: outResult.score >= 0.8 ? 'report' : 'caution',
                });
              }
              outputBlocked = true;
            } else if (outResult.score >= 0.3) {
              outputWarning = true;
              safetyWarning = true;
            }
          } catch {
            // Continue without output scanning if it fails
          }
        }
      }

      if (outputBlocked) return;

      // P2-VAP-003: Verify signature via RPC before marking as signed
      let signed = 0;
      if (signature) {
        try {
          const { getRpcClient } = await import('../indexer/rpc-client.js');
          const rpc = getRpcClient();
          const isValid = await rpc.verifyMessage(socket.verusId, sanitized, signature);
          signed = isValid ? 1 : 0;
        } catch {
          signed = 0; // Can't verify = not signed
        }
      }
      const messageId = jobMessageQueries.insert({
        job_id: jobId,
        sender_verus_id: socket.verusId,
        content: sanitized,
        signed,
        signature: signature || null,
        safety_score: safetyScore,
      });

      const msg = jobMessageQueries.getById(messageId);
      const payload = {
        id: messageId,
        senderVerusId: socket.verusId,
        content: sanitized,
        signed: signed === 1,
        signature: signature || null,
        safetyScore,
        safetyWarning: safetyWarning || outputWarning,
        createdAt: msg?.created_at || new Date().toISOString(),
      };

      // Broadcast to room
      io.to(room).emit('message', payload);

      // Webhook notification for new message
      try {
        const { emitWebhookEvent } = await import('../notifications/webhook-engine.js');
        const { createNotification } = await import('../api/routes/notifications.js');
        const job = jobQueries.getById(jobId);
        if (job) {
          const recipient = socket.verusId === job.buyer_verus_id ? job.seller_verus_id : job.buyer_verus_id;
          emitWebhookEvent({ type: 'message.new', agentVerusId: recipient, jobId, data: { senderVerusId: socket.verusId, preview: sanitized.slice(0, 100) } });
          createNotification({ recipientVerusId: recipient, type: 'message.new', title: 'New Message', body: sanitized.slice(0, 100), jobId });
        }
      } catch {}
    });

    // Typing indicator
    socket.on('typing', (data: { jobId: string }) => {
      if (data?.jobId && socket.rooms.has(`job:${data.jobId}`)) {
        socket.to(`job:${data.jobId}`).emit('typing', {
          verusId: socket.verusId,
          jobId: data.jobId,
        });
      }
    });

    // Read receipt
    socket.on('read', (data: { jobId: string }) => {
      if (data?.jobId && socket.rooms.has(`job:${data.jobId}`)) {
        const now = new Date().toISOString();
        readReceiptQueries.upsert(data.jobId, socket.verusId, now);
        socket.to(`job:${data.jobId}`).emit('read', {
          verusId: socket.verusId,
          jobId: data.jobId,
          readAt: now,
        });
      }
    });

    // Disconnect
    socket.on('disconnect', () => {
      clearInterval(revalidateInterval);
      const currentIp = ipConnections.get(ip);
      if (currentIp !== undefined) {
        if (currentIp <= 1) ipConnections.delete(ip);
        else ipConnections.set(ip, currentIp - 1);
      }
      const currentUser = userConnections.get(socket.verusId);
      if (currentUser !== undefined) {
        if (currentUser <= 1) userConnections.delete(socket.verusId);
        else userConnections.set(socket.verusId, currentUser - 1);
      }
    });
  });

  // Cleanup chat tokens periodically
  setInterval(() => {
    chatTokenQueries.cleanup();
  }, 5 * 60 * 1000);

  // Cleanup stale room trackers
  setInterval(() => {
    const now = Date.now();
    for (const [room, tracker] of roomTrackers) {
      tracker.messages = tracker.messages.filter(m => now - m.timestamp < CIRCUIT_BREAKER_WINDOW_MS);
      if (tracker.messages.length === 0 && !tracker.paused) {
        roomTrackers.delete(room);
      }
      // Auto-unpause after 5 minutes
      if (tracker.paused && tracker.messages.length === 0) {
        tracker.paused = false;
      }
    }
  }, 60 * 1000);

  return io;
}

function parse(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  cookieHeader.split(';').forEach(pair => {
    const [key, ...val] = pair.trim().split('=');
    if (key) cookies[key] = decodeURIComponent(val.join('='));
  });
  return cookies;
}
