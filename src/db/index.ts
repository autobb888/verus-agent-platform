import Database from 'better-sqlite3';
import { config } from '../config/index.js';
import { runMigrations } from './migrations.js';
import { Agent, AgentCapability, AgentEndpoint, SyncState } from './schema.js';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

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

  count: (filters: { status?: string; type?: string }) => {
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

    for (const [key, value] of Object.entries(updates)) {
      if (key !== 'id' && key !== 'verus_id') {
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
    const syncState = syncQueries.get();

    return {
      totalAgents: totalAgents.count,
      activeAgents: activeAgents.count,
      byType: Object.fromEntries(byType.map((r) => [r.type, r.count])),
      totalCapabilityTypes: totalCapabilities.count,
      lastIndexedBlock: syncState.last_block_height,
      lastUpdated: syncState.updated_at,
    };
  },
};
