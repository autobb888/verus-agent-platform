import Database from 'better-sqlite3';

export function runMigrations(db: Database.Database): void {
  // Create agents table
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      verus_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL CHECK (length(name) >= 3 AND length(name) <= 64),
      type TEXT NOT NULL CHECK (type IN ('autonomous', 'assisted', 'tool')),
      description TEXT CHECK (description IS NULL OR length(description) <= 1000),
      owner TEXT NOT NULL,
      status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'deprecated')),
      revoked INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      indexed_at TEXT DEFAULT (datetime('now')),
      block_height INTEGER NOT NULL,
      block_hash TEXT NOT NULL,
      confirmation_count INTEGER DEFAULT 0
    )
  `);

  // Create agent_capabilities table
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_capabilities (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      capability_id TEXT NOT NULL CHECK (length(capability_id) <= 100),
      name TEXT NOT NULL CHECK (length(name) <= 100),
      description TEXT,
      protocol TEXT NOT NULL CHECK (length(protocol) <= 20),
      endpoint TEXT,
      public INTEGER DEFAULT 1,
      pricing_model TEXT CHECK (length(pricing_model) <= 20),
      pricing_amount REAL,
      pricing_currency TEXT CHECK (length(pricing_currency) <= 20)
    )
  `);

  // Create agent_endpoints table
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_endpoints (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      protocol TEXT NOT NULL CHECK (length(protocol) <= 20),
      public INTEGER DEFAULT 1
    )
  `);

  // Create sync_state table for reorg handling
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_state (
      id INTEGER PRIMARY KEY DEFAULT 1,
      last_block_height INTEGER NOT NULL,
      last_block_hash TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name);
    CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
    CREATE INDEX IF NOT EXISTS idx_agents_type ON agents(type);
    CREATE INDEX IF NOT EXISTS idx_agents_block ON agents(block_height);
    CREATE INDEX IF NOT EXISTS idx_capabilities_type ON agent_capabilities(capability_id);
    CREATE INDEX IF NOT EXISTS idx_capabilities_agent ON agent_capabilities(agent_id);
    CREATE INDEX IF NOT EXISTS idx_endpoints_agent ON agent_endpoints(agent_id);
  `);

  // Initialize sync state if not exists
  const syncState = db.prepare('SELECT * FROM sync_state WHERE id = 1').get();
  if (!syncState) {
    db.prepare(
      'INSERT INTO sync_state (id, last_block_height, last_block_hash) VALUES (1, 0, ?)'
    ).run('0'.repeat(64));
  }
}
