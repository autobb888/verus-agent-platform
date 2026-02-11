import Database from 'better-sqlite3';

export function runMigrations(db: Database.Database): void {
  // Create agents table
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      verus_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL CHECK (length(name) >= 3 AND length(name) <= 64),
      type TEXT NOT NULL CHECK (type IN ('autonomous', 'assisted', 'hybrid', 'tool')),
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
      public INTEGER DEFAULT 1,
      verified INTEGER DEFAULT 0,
      verified_at TEXT
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

  // Create endpoint_verifications table (Phase 2 Week 2)
  db.exec(`
    CREATE TABLE IF NOT EXISTS endpoint_verifications (
      id TEXT PRIMARY KEY,
      endpoint_id TEXT NOT NULL REFERENCES agent_endpoints(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      challenge_token TEXT,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'failed', 'stale')),
      retry_count INTEGER DEFAULT 0,
      last_attempt_at TEXT,
      verified_at TEXT,
      next_verification_at TEXT,
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Create auth_challenges table (Dashboard Auth)
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_challenges (
      id TEXT PRIMARY KEY,
      challenge TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      used INTEGER DEFAULT 0
    )
  `);

  // Create sessions table (Dashboard Auth)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      verus_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);

  // Create QR challenges table (Mobile Login)
  db.exec(`
    CREATE TABLE IF NOT EXISTS qr_challenges (
      id TEXT PRIMARY KEY,
      challenge TEXT NOT NULL,
      deeplink TEXT NOT NULL,
      verus_id TEXT,
      signature TEXT,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'signed', 'expired', 'completed')),
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);

  // Phase 3: Services table
  db.exec(`
    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      verus_id TEXT NOT NULL,
      name TEXT NOT NULL CHECK (length(name) >= 3 AND length(name) <= 100),
      description TEXT CHECK (description IS NULL OR length(description) <= 2000),
      price REAL NOT NULL CHECK (price >= 0),
      currency TEXT NOT NULL DEFAULT 'VRSC' CHECK (length(currency) <= 20),
      category TEXT CHECK (category IS NULL OR length(category) <= 50),
      turnaround TEXT CHECK (turnaround IS NULL OR length(turnaround) <= 50),
      status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'deprecated')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      indexed_at TEXT DEFAULT (datetime('now')),
      block_height INTEGER NOT NULL
    )
  `);

  // Phase 3: Reviews table (on-chain reputation)
  db.exec(`
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      agent_verus_id TEXT NOT NULL,
      buyer_verus_id TEXT NOT NULL,
      job_hash TEXT NOT NULL,
      message TEXT CHECK (message IS NULL OR length(message) <= 2000),
      rating INTEGER CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
      signature TEXT NOT NULL,
      review_timestamp INTEGER NOT NULL,
      verified INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      indexed_at TEXT DEFAULT (datetime('now')),
      block_height INTEGER NOT NULL,
      UNIQUE(agent_verus_id, job_hash)
    )
  `);

  // Phase 3: Agent reputation aggregate table
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_reputation (
      agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
      total_reviews INTEGER DEFAULT 0,
      verified_reviews INTEGER DEFAULT 0,
      average_rating REAL,
      total_jobs_completed INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Phase 3: Inbox for pending items (reviews, messages)
  // Platform facilitates but doesn't own - items here are waiting for
  // the agent to add them to their on-chain VerusID
  db.exec(`
    CREATE TABLE IF NOT EXISTS inbox (
      id TEXT PRIMARY KEY,
      recipient_verus_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('review', 'message', 'service_request', 'job_request', 'job_accepted', 'job_delivered', 'job_completed')),
      sender_verus_id TEXT NOT NULL,
      
      -- For reviews
      job_hash TEXT,
      rating INTEGER CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
      message TEXT CHECK (message IS NULL OR length(message) <= 2000),
      signature TEXT,
      
      -- Metadata
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      processed_at TEXT,
      
      -- The formatted VDXF data for the agent to add to their identity
      vdxf_data TEXT
    )
  `);

  // Phase 4: A2A Jobs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      job_hash TEXT UNIQUE NOT NULL,
      
      -- Parties
      buyer_verus_id TEXT NOT NULL,
      seller_verus_id TEXT NOT NULL,
      service_id TEXT REFERENCES services(id) ON DELETE SET NULL,
      
      -- Terms
      description TEXT NOT NULL CHECK (length(description) <= 2000),
      amount REAL NOT NULL CHECK (amount >= 0),
      currency TEXT NOT NULL DEFAULT 'VRSC' CHECK (length(currency) <= 20),
      deadline TEXT,
      
      -- Signatures (proof of agreement)
      request_signature TEXT NOT NULL,
      acceptance_signature TEXT,
      delivery_signature TEXT,
      completion_signature TEXT,
      
      -- State
      status TEXT DEFAULT 'requested' CHECK (status IN ('requested', 'accepted', 'in_progress', 'delivered', 'completed', 'disputed', 'cancelled')),
      
      -- Delivery
      delivery_hash TEXT,
      delivery_message TEXT CHECK (delivery_message IS NULL OR length(delivery_message) <= 2000),
      
      -- Timestamps
      requested_at TEXT NOT NULL,
      accepted_at TEXT,
      delivered_at TEXT,
      completed_at TEXT,
      
      created_at TEXT DEFAULT (datetime('now')),
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
    CREATE INDEX IF NOT EXISTS idx_verifications_status ON endpoint_verifications(status);
    CREATE INDEX IF NOT EXISTS idx_verifications_next ON endpoint_verifications(next_verification_at);
    CREATE INDEX IF NOT EXISTS idx_auth_challenges_expires ON auth_challenges(expires_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_verus_id ON sessions(verus_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    
    -- Phase 3 indexes
    CREATE INDEX IF NOT EXISTS idx_services_agent ON services(agent_id);
    CREATE INDEX IF NOT EXISTS idx_services_verus_id ON services(verus_id);
    CREATE INDEX IF NOT EXISTS idx_services_status ON services(status);
    CREATE INDEX IF NOT EXISTS idx_services_category ON services(category);
    CREATE INDEX IF NOT EXISTS idx_services_price ON services(price);
    CREATE INDEX IF NOT EXISTS idx_reviews_agent ON reviews(agent_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_agent_verus ON reviews(agent_verus_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_buyer ON reviews(buyer_verus_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_job ON reviews(job_hash);
    CREATE INDEX IF NOT EXISTS idx_reviews_verified ON reviews(verified);
    
    -- Inbox indexes
    CREATE INDEX IF NOT EXISTS idx_inbox_recipient ON inbox(recipient_verus_id);
    CREATE INDEX IF NOT EXISTS idx_inbox_status ON inbox(status);
    CREATE INDEX IF NOT EXISTS idx_inbox_type ON inbox(type);
    CREATE INDEX IF NOT EXISTS idx_inbox_expires ON inbox(expires_at);
    
    -- Phase 4: Job indexes
    CREATE INDEX IF NOT EXISTS idx_jobs_buyer ON jobs(buyer_verus_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_seller ON jobs(seller_verus_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_hash ON jobs(job_hash);
    CREATE INDEX IF NOT EXISTS idx_jobs_service ON jobs(service_id);
  `);

  // Phase 4b: Job messages table
  db.exec(`
    CREATE TABLE IF NOT EXISTS job_messages (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      sender_verus_id TEXT NOT NULL,
      content TEXT NOT NULL CHECK (length(content) <= 4000),
      signed INTEGER DEFAULT 0,
      signature TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_job_messages_job ON job_messages(job_id);
    CREATE INDEX IF NOT EXISTS idx_job_messages_sender ON job_messages(sender_verus_id);
  `);

  // Phase 6: Job read receipts table
  db.exec(`
    CREATE TABLE IF NOT EXISTS job_read_receipts (
      job_id TEXT NOT NULL,
      verus_id TEXT NOT NULL,
      last_read_at TEXT NOT NULL,
      PRIMARY KEY (job_id, verus_id)
    )
  `);

  // Phase 6c: Alerts table (anomaly alerts for buyers)
  db.exec(`
    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      buyer_verus_id TEXT NOT NULL,
      agent_verus_id TEXT NOT NULL,
      message_id TEXT,
      type TEXT NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
      title TEXT NOT NULL,
      detail TEXT NOT NULL,
      suggested_action TEXT NOT NULL,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'dismissed', 'reported', 'expired')),
      created_at TEXT DEFAULT (datetime('now')),
      resolved_at TEXT
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_alerts_buyer ON alerts(buyer_verus_id);
    CREATE INDEX IF NOT EXISTS idx_alerts_job ON alerts(job_id);
    CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
  `);

  // Phase 6c: Alert reports table (for platform review)
  db.exec(`
    CREATE TABLE IF NOT EXISTS alert_reports (
      id TEXT PRIMARY KEY,
      alert_id TEXT NOT NULL REFERENCES alerts(id),
      reporter_verus_id TEXT NOT NULL,
      agent_verus_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Phase 6c: Message hold queue (Shield: blocked messages go to hold, not void)
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_hold_queue (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      sender_verus_id TEXT NOT NULL,
      content TEXT NOT NULL,
      safety_score REAL NOT NULL,
      flags TEXT NOT NULL,
      status TEXT DEFAULT 'held' CHECK (status IN ('held', 'released', 'rejected', 'expired')),
      appeal_reason TEXT,
      reviewed_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_hold_queue_job ON message_hold_queue(job_id);
    CREATE INDEX IF NOT EXISTS idx_hold_queue_status ON message_hold_queue(status);
    CREATE INDEX IF NOT EXISTS idx_hold_queue_sender ON message_hold_queue(sender_verus_id);
  `);

  // Phase 6b: Job files table
  db.exec(`
    CREATE TABLE IF NOT EXISTS job_files (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      message_id TEXT REFERENCES job_messages(id),
      uploader_verus_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      storage_path TEXT NOT NULL,
      checksum TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_job_files_job ON job_files(job_id);
    CREATE INDEX IF NOT EXISTS idx_job_files_uploader ON job_files(uploader_verus_id);
  `);

  // Phase 6: Chat tokens table
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_tokens (
      id TEXT PRIMARY KEY,
      verus_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER DEFAULT 0
    )
  `);

  // Phase 6: Add safety_score to job_messages
  try {
    db.exec(`ALTER TABLE job_messages ADD COLUMN safety_score REAL`);
  } catch { /* Column exists */ }

  // Add payment fields to jobs table (if not exists)
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN payment_terms TEXT DEFAULT 'prepay' CHECK (payment_terms IN ('prepay', 'postpay', 'split'))`);
  } catch { /* Column exists */ }
  
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN payment_address TEXT`);
  } catch { /* Column exists */ }
  
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN payment_txid TEXT`);
  } catch { /* Column exists */ }
  
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN payment_verified INTEGER DEFAULT 0`);
  } catch { /* Column exists */ }

  // Initialize sync state if not exists
  const syncState = db.prepare('SELECT * FROM sync_state WHERE id = 1').get();
  if (!syncState) {
    db.prepare(
      'INSERT INTO sync_state (id, last_block_height, last_block_hash) VALUES (1, 0, ?)'
    ).run('0'.repeat(64));
  }

  // Add identity_name column to sessions table (if not exists)
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN identity_name TEXT`);
  } catch {
    // Column already exists, ignore
  }

  // Fix inbox type CHECK constraint — SQLite can't ALTER CHECK, must recreate table
  // Old constraint only had ('review', 'message', 'service_request')
  // Need to add job types: 'job_request', 'job_accepted', 'job_delivered', 'job_completed'
  try {
    const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'inbox'").get() as { sql: string } | undefined;
    if (tableInfo && !tableInfo.sql.includes('job_request')) {
      db.exec(`
        ALTER TABLE inbox RENAME TO inbox_old;

        CREATE TABLE inbox (
          id TEXT PRIMARY KEY,
          recipient_verus_id TEXT NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('review', 'message', 'service_request', 'job_request', 'job_accepted', 'job_delivered', 'job_completed')),
          sender_verus_id TEXT NOT NULL,
          job_hash TEXT,
          rating INTEGER CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
          message TEXT CHECK (message IS NULL OR length(message) <= 2000),
          signature TEXT,
          status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
          created_at TEXT DEFAULT (datetime('now')),
          expires_at TEXT NOT NULL,
          processed_at TEXT,
          vdxf_data TEXT
        );

        INSERT INTO inbox SELECT * FROM inbox_old;

        DROP TABLE inbox_old;

        CREATE INDEX IF NOT EXISTS idx_inbox_recipient ON inbox(recipient_verus_id);
        CREATE INDEX IF NOT EXISTS idx_inbox_status ON inbox(status);
        CREATE INDEX IF NOT EXISTS idx_inbox_type ON inbox(type);
        CREATE INDEX IF NOT EXISTS idx_inbox_expires ON inbox(expires_at);
      `);
      console.log('[Migrations] Inbox table recreated with updated type CHECK constraint');
    }
  } catch (err) {
    console.error('[Migrations] Inbox migration error:', err);
  }

  // Phase 6d: Webhooks for agent notifications
  db.exec(`
    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY,
      agent_verus_id TEXT NOT NULL,
      url TEXT NOT NULL,
      secret TEXT NOT NULL,
      events TEXT NOT NULL DEFAULT '["*"]',
      active INTEGER NOT NULL DEFAULT 1,
      failure_count INTEGER NOT NULL DEFAULT 0,
      last_failure_at TEXT,
      last_success_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      webhook_id TEXT NOT NULL REFERENCES webhooks(id),
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed', 'exhausted')),
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      last_error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      delivered_at TEXT
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_webhooks_agent ON webhooks(agent_verus_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(status, next_attempt_at)`);

  // Phase 6d: Notifications (polling alternative to webhooks)
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      recipient_verus_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      job_id TEXT,
      data TEXT DEFAULT '{}',
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_verus_id, read)`);

  // Phase 6g: Data handling policies & deletion attestation
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_data_policies (
      id TEXT PRIMARY KEY,
      agent_verus_id TEXT UNIQUE NOT NULL,
      retention TEXT NOT NULL DEFAULT 'job-duration' CHECK (retention IN ('none', 'job-duration', '30-days', 'permanent')),
      allow_training INTEGER NOT NULL DEFAULT 0,
      allow_third_party INTEGER NOT NULL DEFAULT 0,
      deletion_attestation_supported INTEGER NOT NULL DEFAULT 0,
      model_info TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS job_data_terms (
      id TEXT PRIMARY KEY,
      job_id TEXT UNIQUE NOT NULL REFERENCES jobs(id),
      retention TEXT NOT NULL DEFAULT 'none' CHECK (retention IN ('none', 'job-duration', '30-days')),
      allow_training INTEGER NOT NULL DEFAULT 0,
      allow_third_party INTEGER NOT NULL DEFAULT 0,
      require_deletion_attestation INTEGER NOT NULL DEFAULT 0,
      accepted_by_seller INTEGER NOT NULL DEFAULT 0,
      accepted_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS deletion_attestations (
      id TEXT PRIMARY KEY,
      job_id TEXT UNIQUE NOT NULL REFERENCES jobs(id),
      agent_verus_id TEXT NOT NULL,
      signature TEXT NOT NULL,
      message TEXT NOT NULL,
      scope TEXT,
      signature_verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_data_policies_agent ON agent_data_policies(agent_verus_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_deletion_attestations_agent ON deletion_attestations(agent_verus_id)`);

  // Onboarding: pending identity registrations
  db.exec(`
    CREATE TABLE IF NOT EXISTS onboard_requests (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      pubkey TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'committing', 'confirming', 'registered', 'failed')),
      commitment_txid TEXT,
      register_txid TEXT,
      identity_name TEXT,
      i_address TEXT,
      error TEXT,
      ip_address TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_onboard_name_pending ON onboard_requests(name) WHERE status IN ('pending', 'committing', 'confirming')`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_onboard_status ON onboard_requests(status)`);
}
