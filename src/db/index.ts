import Database from 'better-sqlite3';
import { config } from '../config/index.js';
import { runMigrations } from './migrations.js';
import { Agent, AgentCapability, AgentEndpoint, SyncState, Service, Review, AgentReputation, InboxItem, Job, JobMessage, JobFile, JobReadReceipt, ChatToken } from './schema.js';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { encryptSecret, decryptSecret } from '../utils/crypto.js';

let db: Database.Database;

export function initDatabase(): Database.Database {
  // Ensure data directory exists
  const dbDir = path.dirname(config.db.path);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(config.db.path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  
  runMigrations(db);
  
  return db;
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

// Agent queries
export const agentQueries = {
  getAll: (filters: {
    status?: string;
    type?: string;
    capability?: string;
    owner?: string;
    limit?: number;
    offset?: number;
    sort?: string;
    order?: 'asc' | 'desc';
  }) => {
    const db = getDatabase();
    let query = 'SELECT DISTINCT a.* FROM agents a';
    const params: any[] = [];
    const conditions: string[] = [];

    if (filters.capability) {
      query += ' JOIN agent_capabilities c ON a.id = c.agent_id';
      conditions.push('c.capability_id = ?');
      params.push(filters.capability);
    }

    if (filters.status) {
      conditions.push('a.status = ?');
      params.push(filters.status);
    }

    if (filters.type) {
      conditions.push('a.type = ?');
      params.push(filters.type);
    }

    if (filters.owner) {
      conditions.push('a.owner = ?');
      params.push(filters.owner);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    // Sorting - whitelist allowed columns
    const allowedSorts = ['created_at', 'updated_at', 'name', 'block_height'];
    const sortCol = allowedSorts.includes(filters.sort || '') ? filters.sort : 'created_at';
    const sortOrder = filters.order === 'asc' ? 'ASC' : 'DESC';
    query += ` ORDER BY a.${sortCol} ${sortOrder}`;

    // Pagination
    const limit = Math.min(Math.max(filters.limit || 20, 1), 100);
    const offset = Math.max(filters.offset || 0, 0);
    query += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return db.prepare(query).all(...params) as Agent[];
  },

  getById: (verusId: string) => {
    const db = getDatabase();
    return db.prepare('SELECT * FROM agents WHERE verus_id = ?').get(verusId) as Agent | undefined;
  },

  getByInternalId: (id: string) => {
    const db = getDatabase();
    return db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Agent | undefined;
  },

  count: (filters: { status?: string; type?: string; owner?: string }) => {
    const db = getDatabase();
    let query = 'SELECT COUNT(*) as count FROM agents';
    const params: any[] = [];
    const conditions: string[] = [];

    if (filters.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }

    if (filters.type) {
      conditions.push('type = ?');
      params.push(filters.type);
    }

    if (filters.owner) {
      conditions.push('owner = ?');
      params.push(filters.owner);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    const result = db.prepare(query).get(...params) as { count: number };
    return result.count;
  },

  insert: (agent: Omit<Agent, 'id' | 'indexed_at'>) => {
    const db = getDatabase();
    const id = randomUUID();
    db.prepare(`
      INSERT INTO agents (id, verus_id, name, type, description, owner, status, revoked, created_at, updated_at, block_height, block_hash, confirmation_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      agent.verus_id,
      agent.name,
      agent.type,
      agent.description,
      agent.owner,
      agent.status,
      agent.revoked ? 1 : 0,
      agent.created_at,
      agent.updated_at,
      agent.block_height,
      agent.block_hash,
      agent.confirmation_count
    );
    return id;
  },

  update: (verusId: string, updates: Partial<Agent>) => {
    const db = getDatabase();
    const setClauses: string[] = [];
    const params: any[] = [];
    // P1-VAP-002: Whitelist allowed columns to prevent SQL injection via key names
    const ALLOWED_COLS = new Set(['name', 'type', 'description', 'owner', 'status', 'revoked', 'public', 'updated_at', 'indexed_at', 'block_height', 'block_hash', 'tx_hash']);

    for (const [key, value] of Object.entries(updates)) {
      if (ALLOWED_COLS.has(key)) {
        setClauses.push(`${key} = ?`);
        params.push(value);
      }
    }

    if (setClauses.length === 0) return;

    params.push(verusId);
    db.prepare(`UPDATE agents SET ${setClauses.join(', ')} WHERE verus_id = ?`).run(...params);
  },

  deleteByBlockHeight: (minHeight: number) => {
    const db = getDatabase();
    db.prepare('DELETE FROM agents WHERE block_height >= ?').run(minHeight);
  },
};

// Capability queries
export const capabilityQueries = {
  getByAgentId: (agentId: string) => {
    const db = getDatabase();
    return db.prepare('SELECT * FROM agent_capabilities WHERE agent_id = ?').all(agentId) as AgentCapability[];
  },

  getAllTypes: () => {
    const db = getDatabase();
    return db.prepare('SELECT DISTINCT capability_id, name FROM agent_capabilities').all() as { capability_id: string; name: string }[];
  },

  insert: (capability: Omit<AgentCapability, 'id'>) => {
    const db = getDatabase();
    const id = randomUUID();
    db.prepare(`
      INSERT INTO agent_capabilities (id, agent_id, capability_id, name, description, protocol, endpoint, public, pricing_model, pricing_amount, pricing_currency)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      capability.agent_id,
      capability.capability_id,
      capability.name,
      capability.description,
      capability.protocol,
      capability.endpoint,
      capability.public ? 1 : 0,
      capability.pricing_model,
      capability.pricing_amount,
      capability.pricing_currency
    );
    return id;
  },

  deleteByAgentId: (agentId: string) => {
    const db = getDatabase();
    db.prepare('DELETE FROM agent_capabilities WHERE agent_id = ?').run(agentId);
  },
};

// Endpoint queries
export const endpointQueries = {
  getByAgentId: (agentId: string) => {
    const db = getDatabase();
    return db.prepare('SELECT * FROM agent_endpoints WHERE agent_id = ?').all(agentId) as AgentEndpoint[];
  },

  insert: (endpoint: Omit<AgentEndpoint, 'id'>) => {
    const db = getDatabase();
    const id = randomUUID();
    db.prepare(`
      INSERT INTO agent_endpoints (id, agent_id, url, protocol, public)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, endpoint.agent_id, endpoint.url, endpoint.protocol, endpoint.public ? 1 : 0);
    return id;
  },

  deleteByAgentId: (agentId: string) => {
    const db = getDatabase();
    db.prepare('DELETE FROM agent_endpoints WHERE agent_id = ?').run(agentId);
  },
};

// Sync state queries
export const syncQueries = {
  get: () => {
    const db = getDatabase();
    return db.prepare('SELECT * FROM sync_state WHERE id = 1').get() as SyncState;
  },

  update: (height: number, hash: string) => {
    const db = getDatabase();
    db.prepare(
      "UPDATE sync_state SET last_block_height = ?, last_block_hash = ?, updated_at = datetime('now') WHERE id = 1"
    ).run(height, hash);
  },
};

// Stats
export const statsQueries = {
  getStats: () => {
    const db = getDatabase();
    const totalAgents = db.prepare('SELECT COUNT(*) as count FROM agents').get() as { count: number };
    const activeAgents = db.prepare('SELECT COUNT(*) as count FROM agents WHERE status = ?').get('active') as { count: number };
    const byType = db.prepare('SELECT type, COUNT(*) as count FROM agents GROUP BY type').all() as { type: string; count: number }[];
    const totalCapabilities = db.prepare('SELECT COUNT(DISTINCT capability_id) as count FROM agent_capabilities').get() as { count: number };
    const totalServices = db.prepare('SELECT COUNT(*) as count FROM services WHERE status = ?').get('active') as { count: number };
    const totalReviews = db.prepare('SELECT COUNT(*) as count FROM reviews').get() as { count: number };
    const syncState = syncQueries.get();

    return {
      totalAgents: totalAgents.count,
      activeAgents: activeAgents.count,
      byType: Object.fromEntries(byType.map((r) => [r.type, r.count])),
      totalCapabilityTypes: totalCapabilities.count,
      totalServices: totalServices.count,
      totalReviews: totalReviews.count,
      lastIndexedBlock: syncState.last_block_height,
      lastUpdated: syncState.updated_at,
    };
  },
};

// Phase 3: Service queries
export const serviceQueries = {
  getAll: (filters: {
    agentId?: string;
    verusId?: string;
    category?: string;
    status?: string;
    minPrice?: number;
    maxPrice?: number;
    q?: string;
    limit?: number;
    offset?: number;
    sort?: string;
    order?: 'asc' | 'desc';
  }) => {
    const db = getDatabase();
    let query = 'SELECT s.*, a.name as agent_name FROM services s JOIN agents a ON s.agent_id = a.id';
    const params: any[] = [];
    const conditions: string[] = [];

    if (filters.agentId) {
      conditions.push('s.agent_id = ?');
      params.push(filters.agentId);
    }

    if (filters.verusId) {
      conditions.push('s.verus_id = ?');
      params.push(filters.verusId);
    }

    if (filters.category) {
      conditions.push('s.category = ?');
      params.push(filters.category);
    }

    if (filters.status) {
      conditions.push('s.status = ?');
      params.push(filters.status);
    }

    if (filters.minPrice !== undefined) {
      conditions.push('s.price >= ?');
      params.push(filters.minPrice);
    }

    if (filters.maxPrice !== undefined) {
      conditions.push('s.price <= ?');
      params.push(filters.maxPrice);
    }

    if (filters.q) {
      const escapedQ = filters.q.replace(/[%_\\]/g, '\\$&');
      conditions.push("(s.name LIKE ? ESCAPE '\\' OR s.description LIKE ? ESCAPE '\\' OR a.name LIKE ? ESCAPE '\\' OR s.category LIKE ? ESCAPE '\\')");
      params.push(`%${escapedQ}%`, `%${escapedQ}%`, `%${escapedQ}%`, `%${escapedQ}%`);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    // Sorting
    const allowedSorts = ['created_at', 'updated_at', 'name', 'price'];
    const sortCol = allowedSorts.includes(filters.sort || '') ? filters.sort : 'created_at';
    const sortOrder = filters.order === 'asc' ? 'ASC' : 'DESC';
    query += ` ORDER BY s.${sortCol} ${sortOrder}`;

    // Pagination
    const limit = Math.min(Math.max(filters.limit || 20, 1), 100);
    const offset = Math.max(filters.offset || 0, 0);
    query += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return db.prepare(query).all(...params) as (Service & { agent_name: string })[];
  },

  getById: (id: string) => {
    const db = getDatabase();
    return db.prepare('SELECT s.*, a.name as agent_name FROM services s JOIN agents a ON s.agent_id = a.id WHERE s.id = ?').get(id) as (Service & { agent_name: string }) | undefined;
  },

  getByAgentId: (agentId: string) => {
    const db = getDatabase();
    return db.prepare('SELECT * FROM services WHERE agent_id = ?').all(agentId) as Service[];
  },

  insert: (service: Omit<Service, 'id' | 'indexed_at'>) => {
    const db = getDatabase();
    const id = randomUUID();
    db.prepare(`
      INSERT INTO services (id, agent_id, verus_id, name, description, price, currency, category, turnaround, status, created_at, updated_at, block_height)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      service.agent_id,
      service.verus_id,
      service.name,
      service.description,
      service.price,
      service.currency,
      service.category,
      service.turnaround,
      service.status,
      service.created_at,
      service.updated_at,
      service.block_height
    );
    return id;
  },

  update: (id: string, updates: Partial<Service>) => {
    const db = getDatabase();
    const setClauses: string[] = [];
    const params: any[] = [];
    // P1-VAP-002: Whitelist allowed columns
    const ALLOWED_COLS = new Set(['name', 'description', 'price', 'currency', 'category', 'turnaround', 'status', 'verus_id', 'updated_at']);

    for (const [key, value] of Object.entries(updates)) {
      if (ALLOWED_COLS.has(key)) {
        setClauses.push(`${key} = ?`);
        params.push(value);
      }
    }

    if (setClauses.length === 0) return;

    params.push(id);
    db.prepare(`UPDATE services SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);
  },

  delete: (id: string) => {
    const db = getDatabase();
    db.prepare('DELETE FROM services WHERE id = ?').run(id);
  },

  deleteByAgentId: (agentId: string) => {
    const db = getDatabase();
    db.prepare('DELETE FROM services WHERE agent_id = ?').run(agentId);
  },

  count: (filters: { status?: string; category?: string }) => {
    const db = getDatabase();
    let query = 'SELECT COUNT(*) as count FROM services';
    const params: any[] = [];
    const conditions: string[] = [];

    if (filters.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }

    if (filters.category) {
      conditions.push('category = ?');
      params.push(filters.category);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    const result = db.prepare(query).get(...params) as { count: number };
    return result.count;
  },

  getCategories: () => {
    const db = getDatabase();
    return db.prepare('SELECT DISTINCT category FROM services WHERE category IS NOT NULL').all() as { category: string }[];
  },
};

// Phase 3: Review queries
export const reviewQueries = {
  getByAgent: (agentVerusId: string, limit = 20, offset = 0) => {
    const db = getDatabase();
    return db.prepare(`
      SELECT * FROM reviews 
      WHERE agent_verus_id = ? 
      ORDER BY review_timestamp DESC 
      LIMIT ? OFFSET ?
    `).all(agentVerusId, limit, offset) as Review[];
  },

  getByBuyer: (buyerVerusId: string, limit = 20, offset = 0) => {
    const db = getDatabase();
    return db.prepare(`
      SELECT * FROM reviews 
      WHERE buyer_verus_id = ? 
      ORDER BY review_timestamp DESC 
      LIMIT ? OFFSET ?
    `).all(buyerVerusId, limit, offset) as Review[];
  },

  getByJobHash: (jobHash: string) => {
    const db = getDatabase();
    return db.prepare('SELECT * FROM reviews WHERE job_hash = ?').get(jobHash) as Review | undefined;
  },

  insert: (review: Omit<Review, 'id' | 'created_at' | 'indexed_at'>) => {
    const db = getDatabase();
    const id = randomUUID();
    db.prepare(`
      INSERT INTO reviews (id, agent_id, agent_verus_id, buyer_verus_id, job_hash, message, rating, signature, review_timestamp, verified, block_height)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      review.agent_id,
      review.agent_verus_id,
      review.buyer_verus_id,
      review.job_hash,
      review.message,
      review.rating,
      review.signature,
      review.review_timestamp,
      review.verified ? 1 : 0,
      review.block_height
    );
    return id;
  },

  updateVerified: (id: string, verified: boolean) => {
    const db = getDatabase();
    db.prepare('UPDATE reviews SET verified = ? WHERE id = ?').run(verified ? 1 : 0, id);
  },

  count: (agentVerusId: string) => {
    const db = getDatabase();
    const result = db.prepare('SELECT COUNT(*) as count FROM reviews WHERE agent_verus_id = ?').get(agentVerusId) as { count: number };
    return result.count;
  },

  countVerified: (agentVerusId: string) => {
    const db = getDatabase();
    const result = db.prepare('SELECT COUNT(*) as count FROM reviews WHERE agent_verus_id = ? AND verified = 1').get(agentVerusId) as { count: number };
    return result.count;
  },
};

// Phase 3: Reputation queries
export const reputationQueries = {
  get: (agentId: string) => {
    const db = getDatabase();
    return db.prepare('SELECT * FROM agent_reputation WHERE agent_id = ?').get(agentId) as AgentReputation | undefined;
  },

  upsert: (reputation: AgentReputation) => {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO agent_reputation (agent_id, total_reviews, verified_reviews, average_rating, total_jobs_completed, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(agent_id) DO UPDATE SET
        total_reviews = excluded.total_reviews,
        verified_reviews = excluded.verified_reviews,
        average_rating = excluded.average_rating,
        total_jobs_completed = excluded.total_jobs_completed,
        updated_at = datetime('now')
    `).run(
      reputation.agent_id,
      reputation.total_reviews,
      reputation.verified_reviews,
      reputation.average_rating,
      reputation.total_jobs_completed
    );
  },

  recalculate: (agentId: string) => {
    const db = getDatabase();
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total_reviews,
        SUM(CASE WHEN verified = 1 THEN 1 ELSE 0 END) as verified_reviews,
        AVG(rating) as average_rating
      FROM reviews 
      WHERE agent_id = ?
    `).get(agentId) as { total_reviews: number; verified_reviews: number; average_rating: number | null };

    db.prepare(`
      INSERT INTO agent_reputation (agent_id, total_reviews, verified_reviews, average_rating, total_jobs_completed, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(agent_id) DO UPDATE SET
        total_reviews = excluded.total_reviews,
        verified_reviews = excluded.verified_reviews,
        average_rating = excluded.average_rating,
        total_jobs_completed = excluded.total_reviews,
        updated_at = datetime('now')
    `).run(agentId, stats.total_reviews, stats.verified_reviews, stats.average_rating, stats.total_reviews);

    return stats;
  },

  getTopAgents: (limit = 10) => {
    const db = getDatabase();
    return db.prepare(`
      SELECT r.*, a.verus_id, a.name 
      FROM agent_reputation r 
      JOIN agents a ON r.agent_id = a.id 
      WHERE r.verified_reviews > 0 
      ORDER BY r.average_rating DESC, r.verified_reviews DESC 
      LIMIT ?
    `).all(limit) as (AgentReputation & { verus_id: string; name: string })[];
  },
};

// Phase 3: Inbox queries (facilitator pattern)
export const inboxQueries = {
  getByRecipient: (recipientVerusId: string, status = 'pending', limit = 20, offset = 0) => {
    const db = getDatabase();
    return db.prepare(`
      SELECT * FROM inbox 
      WHERE recipient_verus_id = ? AND status = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(recipientVerusId, status, limit, offset) as InboxItem[];
  },

  getById: (id: string) => {
    const db = getDatabase();
    return db.prepare('SELECT * FROM inbox WHERE id = ?').get(id) as InboxItem | undefined;
  },

  insert: (item: Omit<InboxItem, 'id' | 'created_at' | 'processed_at'>) => {
    const db = getDatabase();
    const id = randomUUID();
    db.prepare(`
      INSERT INTO inbox (id, recipient_verus_id, type, sender_verus_id, job_hash, rating, message, signature, status, expires_at, vdxf_data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      item.recipient_verus_id,
      item.type,
      item.sender_verus_id,
      item.job_hash,
      item.rating,
      item.message,
      item.signature,
      item.status,
      item.expires_at,
      item.vdxf_data
    );
    return id;
  },

  updateStatus: (id: string, status: 'pending' | 'accepted' | 'rejected' | 'expired') => {
    const db = getDatabase();
    db.prepare(`
      UPDATE inbox SET status = ?, processed_at = datetime('now') WHERE id = ?
    `).run(status, id);
  },

  countPending: (recipientVerusId: string) => {
    const db = getDatabase();
    const result = db.prepare(`
      SELECT COUNT(*) as count FROM inbox WHERE recipient_verus_id = ? AND status = 'pending'
    `).get(recipientVerusId) as { count: number };
    return result.count;
  },

  cleanupExpired: () => {
    const db = getDatabase();
    const result = db.prepare(`
      UPDATE inbox SET status = 'expired' WHERE status = 'pending' AND expires_at < datetime('now')
    `).run();
    return result.changes;
  },

  deleteOld: (daysOld = 30) => {
    const db = getDatabase();
    const result = db.prepare(`
      DELETE FROM inbox WHERE created_at < datetime('now', '-' || ? || ' days') AND status != 'pending'
    `).run(daysOld);
    return result.changes;
  },

  // P3-DUP-1: Check for duplicate pending review
  findPendingReview: (recipientVerusId: string, senderVerusId: string, jobHash: string) => {
    const db = getDatabase();
    return db.prepare(`
      SELECT id FROM inbox 
      WHERE recipient_verus_id = ? 
        AND sender_verus_id = ? 
        AND job_hash = ? 
        AND status = 'pending'
      LIMIT 1
    `).get(recipientVerusId, senderVerusId, jobHash) as { id: string } | undefined;
  },
};

// Phase 4: A2A Job queries
export const jobQueries = {
  getById: (id: string) => {
    const db = getDatabase();
    return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Job | undefined;
  },

  getByHash: (jobHash: string) => {
    const db = getDatabase();
    return db.prepare('SELECT * FROM jobs WHERE job_hash = ?').get(jobHash) as Job | undefined;
  },

  getByBuyer: (buyerVerusId: string, status?: string, limit = 20, offset = 0) => {
    const db = getDatabase();
    if (status) {
      return db.prepare(`
        SELECT * FROM jobs WHERE buyer_verus_id = ? AND status = ?
        ORDER BY created_at DESC LIMIT ? OFFSET ?
      `).all(buyerVerusId, status, limit, offset) as Job[];
    }
    return db.prepare(`
      SELECT * FROM jobs WHERE buyer_verus_id = ?
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(buyerVerusId, limit, offset) as Job[];
  },

  getBySeller: (sellerVerusId: string, status?: string, limit = 20, offset = 0) => {
    const db = getDatabase();
    if (status) {
      return db.prepare(`
        SELECT * FROM jobs WHERE seller_verus_id = ? AND status = ?
        ORDER BY created_at DESC LIMIT ? OFFSET ?
      `).all(sellerVerusId, status, limit, offset) as Job[];
    }
    return db.prepare(`
      SELECT * FROM jobs WHERE seller_verus_id = ?
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(sellerVerusId, limit, offset) as Job[];
  },

  insert: (job: Omit<Job, 'id' | 'created_at' | 'updated_at'>) => {
    const db = getDatabase();
    const id = randomUUID();
    db.prepare(`
      INSERT INTO jobs (
        id, job_hash, buyer_verus_id, seller_verus_id, service_id,
        description, amount, currency, deadline,
        payment_terms, payment_address, payment_txid, payment_verified,
        request_signature, acceptance_signature, delivery_signature, completion_signature,
        status, delivery_hash, delivery_message,
        requested_at, accepted_at, delivered_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      job.job_hash,
      job.buyer_verus_id,
      job.seller_verus_id,
      job.service_id,
      job.description,
      job.amount,
      job.currency,
      job.deadline,
      job.payment_terms,
      job.payment_address,
      job.payment_txid,
      job.payment_verified,
      job.request_signature,
      job.acceptance_signature,
      job.delivery_signature,
      job.completion_signature,
      job.status,
      job.delivery_hash,
      job.delivery_message,
      job.requested_at,
      job.accepted_at,
      job.delivered_at,
      job.completed_at
    );
    return id;
  },

  updateStatus: (id: string, status: Job['status']) => {
    const db = getDatabase();
    db.prepare(`UPDATE jobs SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id);
  },

  // P4-RACE-1: Atomic state update with status check
  setAccepted: (id: string, signature: string) => {
    const db = getDatabase();
    const result = db.prepare(`
      UPDATE jobs SET 
        status = 'accepted',
        acceptance_signature = ?,
        accepted_at = datetime('now'),
        updated_at = datetime('now')
      WHERE id = ? AND status = 'requested'
    `).run(signature, id);
    return result.changes > 0;
  },

  setInProgress: (id: string) => {
    const db = getDatabase();
    const result = db.prepare(`
      UPDATE jobs SET status = 'in_progress', updated_at = datetime('now') 
      WHERE id = ? AND status = 'accepted'
    `).run(id);
    return result.changes > 0;
  },

  // P4-RACE-1: Atomic state update
  setDelivered: (id: string, signature: string, deliveryHash: string, deliveryMessage?: string) => {
    const db = getDatabase();
    const result = db.prepare(`
      UPDATE jobs SET 
        status = 'delivered',
        delivery_signature = ?,
        delivery_hash = ?,
        delivery_message = ?,
        delivered_at = datetime('now'),
        updated_at = datetime('now')
      WHERE id = ? AND status IN ('accepted', 'in_progress')
    `).run(signature, deliveryHash, deliveryMessage || null, id);
    return result.changes > 0;
  },

  // P4-RACE-1: Atomic state update
  setCompleted: (id: string, signature: string) => {
    const db = getDatabase();
    const result = db.prepare(`
      UPDATE jobs SET 
        status = 'completed',
        completion_signature = ?,
        completed_at = datetime('now'),
        updated_at = datetime('now')
      WHERE id = ? AND status = 'delivered'
    `).run(signature, id);
    return result.changes > 0;
  },

  // P4-RACE-1: Atomic state update
  setDisputed: (id: string) => {
    const db = getDatabase();
    const result = db.prepare(`
      UPDATE jobs SET status = 'disputed', updated_at = datetime('now') 
      WHERE id = ? AND status NOT IN ('completed', 'cancelled', 'disputed')
    `).run(id);
    return result.changes > 0;
  },

  // P4-RACE-1: Atomic state update
  setCancelled: (id: string) => {
    const db = getDatabase();
    const result = db.prepare(`
      UPDATE jobs SET status = 'cancelled', updated_at = datetime('now') 
      WHERE id = ? AND status = 'requested'
    `).run(id);
    return result.changes > 0;
  },

  countByStatus: (verusId: string, role: 'buyer' | 'seller') => {
    const db = getDatabase();
    const column = role === 'buyer' ? 'buyer_verus_id' : 'seller_verus_id';
    return db.prepare(`
      SELECT status, COUNT(*) as count FROM jobs WHERE ${column} = ? GROUP BY status
    `).all(verusId) as { status: string; count: number }[];
  },

  setPayment: (id: string, txid: string, verified: number = 0) => {
    const db = getDatabase();
    const result = db.prepare(`
      UPDATE jobs SET payment_txid = ?, payment_verified = ?, updated_at = datetime('now') WHERE id = ?
    `).run(txid, verified, id);
    return result.changes > 0;
  },

  verifyPayment: (id: string) => {
    const db = getDatabase();
    const result = db.prepare(`
      UPDATE jobs SET payment_verified = 1, updated_at = datetime('now') WHERE id = ?
    `).run(id);
    return result.changes > 0;
  },
};

// Phase 4b: Job Message Queries
export const jobMessageQueries = {
  getByJobId: (jobId: string, limit = 50, offset = 0) => {
    const db = getDatabase();
    return db.prepare(`
      SELECT * FROM job_messages 
      WHERE job_id = ? 
      ORDER BY created_at ASC
      LIMIT ? OFFSET ?
    `).all(jobId, limit, offset) as JobMessage[];
  },

  countByJobId: (jobId: string) => {
    const db = getDatabase();
    const result = db.prepare(`
      SELECT COUNT(*) as count FROM job_messages WHERE job_id = ?
    `).get(jobId) as { count: number };
    return result.count;
  },

  getByJobIdSince: (jobId: string, since: string, limit = 100) => {
    const db = getDatabase();
    return db.prepare(`
      SELECT * FROM job_messages 
      WHERE job_id = ? AND created_at > ?
      ORDER BY created_at ASC
      LIMIT ?
    `).all(jobId, since, limit) as JobMessage[];
  },

  getById: (id: string) => {
    const db = getDatabase();
    return db.prepare(`SELECT * FROM job_messages WHERE id = ?`).get(id) as JobMessage | undefined;
  },

  insert: (message: Omit<JobMessage, 'id' | 'created_at'>) => {
    const db = getDatabase();
    const id = randomUUID();
    db.prepare(`
      INSERT INTO job_messages (id, job_id, sender_verus_id, content, signed, signature, safety_score)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      message.job_id,
      message.sender_verus_id,
      message.content,
      message.signed,
      message.signature,
      message.safety_score ?? null
    );
    return id;
  },

  delete: (id: string) => {
    const db = getDatabase();
    db.prepare('DELETE FROM job_messages WHERE id = ?').run(id);
  },
};

// Phase 6b: Job File queries
export const jobFileQueries = {
  getById: (id: string) => {
    const db = getDatabase();
    return db.prepare('SELECT * FROM job_files WHERE id = ?').get(id) as JobFile | undefined;
  },

  getByJobId: (jobId: string) => {
    const db = getDatabase();
    return db.prepare('SELECT * FROM job_files WHERE job_id = ? ORDER BY created_at ASC').all(jobId) as JobFile[];
  },

  countByJobId: (jobId: string) => {
    const db = getDatabase();
    const result = db.prepare('SELECT COUNT(*) as count FROM job_files WHERE job_id = ?').get(jobId) as { count: number };
    return result.count;
  },

  insert: (file: Omit<JobFile, 'created_at'>) => {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO job_files (id, job_id, message_id, uploader_verus_id, filename, mime_type, size_bytes, storage_path, checksum)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      file.id,
      file.job_id,
      file.message_id,
      file.uploader_verus_id,
      file.filename,
      file.mime_type,
      file.size_bytes,
      file.storage_path,
      file.checksum
    );
    return file.id;
  },

  setMessageId: (fileId: string, messageId: string) => {
    const db = getDatabase();
    db.prepare('UPDATE job_files SET message_id = ? WHERE id = ?').run(messageId, fileId);
  },

  delete: (id: string) => {
    const db = getDatabase();
    db.prepare('DELETE FROM job_files WHERE id = ?').run(id);
  },

  deleteByJobId: (jobId: string) => {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM job_files WHERE job_id = ?').run(jobId);
    return result.changes;
  },

  getExpiredJobFiles: (daysAfterCompletion: number = 30) => {
    const db = getDatabase();
    return db.prepare(`
      SELECT jf.* FROM job_files jf
      JOIN jobs j ON jf.job_id = j.id
      WHERE j.status = 'completed'
        AND j.completed_at < datetime('now', '-' || ? || ' days')
    `).all(daysAfterCompletion) as JobFile[];
  },
};

// Read receipt queries
export const readReceiptQueries = {
  upsert: (jobId: string, verusId: string, lastReadAt: string) => {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO job_read_receipts (job_id, verus_id, last_read_at)
      VALUES (?, ?, ?)
      ON CONFLICT(job_id, verus_id) DO UPDATE SET last_read_at = excluded.last_read_at
    `).run(jobId, verusId, lastReadAt);
  },

  get: (jobId: string, verusId: string) => {
    const db = getDatabase();
    return db.prepare(`
      SELECT * FROM job_read_receipts WHERE job_id = ? AND verus_id = ?
    `).get(jobId, verusId) as JobReadReceipt | undefined;
  },

  getUnreadJobs: (verusId: string) => {
    const db = getDatabase();
    return db.prepare(`
      SELECT j.id as job_id, j.job_hash, j.description, j.status,
        COUNT(m.id) as unread_count,
        MAX(m.created_at) as latest_message_at
      FROM jobs j
      JOIN job_messages m ON m.job_id = j.id
      LEFT JOIN job_read_receipts r ON r.job_id = j.id AND r.verus_id = ?
      WHERE (j.buyer_verus_id = ? OR j.seller_verus_id = ?)
        AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at)
      GROUP BY j.id
      ORDER BY latest_message_at DESC
    `).all(verusId, verusId, verusId) as Array<{
      job_id: string;
      job_hash: string;
      description: string;
      status: string;
      unread_count: number;
      latest_message_at: string;
    }>;
  },
};

// Chat token queries
export const chatTokenQueries = {
  insert: (token: Omit<ChatToken, 'used'>) => {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO chat_tokens (id, verus_id, created_at, expires_at, used)
      VALUES (?, ?, ?, ?, 0)
    `).run(token.id, token.verus_id, token.created_at, token.expires_at);
  },

  consume: (id: string): ChatToken | undefined => {
    const db = getDatabase();
    const now = new Date().toISOString();
    const result = db.prepare(`
      UPDATE chat_tokens SET used = 1 WHERE id = ? AND used = 0 AND expires_at > ?
    `).run(id, now);
    if (result.changes === 0) return undefined;
    return db.prepare(`SELECT * FROM chat_tokens WHERE id = ?`).get(id) as ChatToken | undefined;
  },

  cleanup: () => {
    const db = getDatabase();
    const now = new Date().toISOString();
    db.prepare(`DELETE FROM chat_tokens WHERE expires_at < ? OR used = 1`).run(now);
  },
};

// Phase 6d: Webhook queries
export const webhookQueries = {
  insert: (data: { agentVerusId: string; url: string; secret: string; events: string[] }) => {
    const db = getDatabase();
    const id = randomUUID();
    db.prepare(`
      INSERT INTO webhooks (id, agent_verus_id, url, secret, events) VALUES (?, ?, ?, ?, ?)
    `).run(id, data.agentVerusId, data.url, encryptSecret(data.secret), JSON.stringify(data.events));
    return id;
  },

  getByAgent: (agentVerusId: string) => {
    const db = getDatabase();
    return db.prepare(`SELECT * FROM webhooks WHERE agent_verus_id = ? ORDER BY created_at DESC`).all(agentVerusId) as any[];
  },

  getById: (id: string) => {
    const db = getDatabase();
    return db.prepare(`SELECT * FROM webhooks WHERE id = ?`).get(id) as any | undefined;
  },

  getActiveForEvent: (agentVerusId: string, eventType: string) => {
    const db = getDatabase();
    const hooks = db.prepare(`
      SELECT * FROM webhooks WHERE agent_verus_id = ? AND active = 1 AND failure_count < 10
    `).all(agentVerusId) as any[];
    return hooks.filter(h => {
      const events = JSON.parse(h.events);
      return events.includes('*') || events.includes(eventType);
    });
  },

  update: (id: string, data: { url?: string; events?: string[]; active?: boolean }) => {
    const db = getDatabase();
    const sets: string[] = [];
    const vals: any[] = [];
    if (data.url !== undefined) { sets.push('url = ?'); vals.push(data.url); }
    if (data.events !== undefined) { sets.push('events = ?'); vals.push(JSON.stringify(data.events)); }
    if (data.active !== undefined) { sets.push('active = ?'); vals.push(data.active ? 1 : 0); }
    sets.push("updated_at = datetime('now')");
    vals.push(id);
    return db.prepare(`UPDATE webhooks SET ${sets.join(', ')} WHERE id = ?`).run(...vals).changes > 0;
  },

  delete: (id: string) => {
    const db = getDatabase();
    db.prepare(`DELETE FROM webhook_deliveries WHERE webhook_id = ?`).run(id);
    return db.prepare(`DELETE FROM webhooks WHERE id = ?`).run(id).changes > 0;
  },

  recordSuccess: (id: string) => {
    const db = getDatabase();
    db.prepare(`UPDATE webhooks SET failure_count = 0, last_success_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(id);
  },

  recordFailure: (id: string) => {
    const db = getDatabase();
    db.prepare(`UPDATE webhooks SET failure_count = failure_count + 1, last_failure_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(id);
    // Auto-disable after 10 consecutive failures
    db.prepare(`UPDATE webhooks SET active = 0 WHERE id = ? AND failure_count >= 10`).run(id);
  },
};

export const webhookDeliveryQueries = {
  insert: (data: { webhookId: string; eventType: string; payload: string }) => {
    const db = getDatabase();
    const id = randomUUID();
    const nextAttempt = new Date().toISOString();
    db.prepare(`
      INSERT INTO webhook_deliveries (id, webhook_id, event_type, payload, next_attempt_at) VALUES (?, ?, ?, ?, ?)
    `).run(id, data.webhookId, data.eventType, data.payload, nextAttempt);
    return id;
  },

  getPending: (limit: number = 20) => {
    const db = getDatabase();
    const now = new Date().toISOString();
    return db.prepare(`
      SELECT d.*, w.url, w.secret FROM webhook_deliveries d
      JOIN webhooks w ON d.webhook_id = w.id
      WHERE d.status = 'pending' AND d.next_attempt_at <= ?
      ORDER BY d.next_attempt_at ASC LIMIT ?
    `).all(now, limit) as any[];
  },

  markDelivered: (id: string) => {
    const db = getDatabase();
    db.prepare(`UPDATE webhook_deliveries SET status = 'delivered', delivered_at = datetime('now'), attempts = attempts + 1 WHERE id = ?`).run(id);
  },

  markFailed: (id: string, error: string) => {
    const db = getDatabase();
    const delivery = db.prepare(`SELECT attempts FROM webhook_deliveries WHERE id = ?`).get(id) as any;
    const attempts = (delivery?.attempts || 0) + 1;
    if (attempts >= 5) {
      db.prepare(`UPDATE webhook_deliveries SET status = 'exhausted', attempts = ?, last_error = ? WHERE id = ?`).run(attempts, error, id);
    } else {
      // Exponential backoff: 30s, 2m, 8m, 32m
      const delayMs = Math.pow(4, attempts) * 30 * 1000;
      const nextAttempt = new Date(Date.now() + delayMs).toISOString();
      db.prepare(`UPDATE webhook_deliveries SET attempts = ?, last_error = ?, next_attempt_at = ? WHERE id = ?`).run(attempts, error, nextAttempt, id);
    }
  },

  cleanup: (olderThanDays: number = 7) => {
    const db = getDatabase();
    db.prepare(`DELETE FROM webhook_deliveries WHERE status IN ('delivered', 'exhausted') AND created_at < datetime('now', '-' || ? || ' days')`).run(olderThanDays);
  },
};
