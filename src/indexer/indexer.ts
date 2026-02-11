import { config } from '../config/index.js';
import { getRpcClient } from './rpc-client.js';
import { agentQueries, capabilityQueries, endpointQueries, syncQueries, serviceQueries, reviewQueries, reputationQueries, getDatabase } from '../db/index.js';
import { parseAgentData } from '../validation/vdxf-schema.js';
import { hasAgentData, hasServiceData, hasReviewData, extractAgentData, extractServiceData, extractServicesArray, extractReviews } from '../validation/vdxf-keys.js';

interface IndexerState {
  running: boolean;
  lastError: string | null;
  lastProcessedBlock: number;
}

const state: IndexerState = {
  running: false,
  lastError: null,
  lastProcessedBlock: 0,
};

export function getIndexerState(): IndexerState {
  return { ...state };
}

export async function startIndexer(): Promise<void> {
  if (state.running) {
    console.log('[Indexer] Already running');
    return;
  }

  state.running = true;
  state.lastError = null;
  console.log('[Indexer] Starting...');

  indexLoop();
}

export function stopIndexer(): void {
  state.running = false;
  console.log('[Indexer] Stopped');
}

async function indexLoop(): Promise<void> {
  while (state.running) {
    try {
      await processNewBlocks();
    } catch (err) {
      state.lastError = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Indexer] Error:', state.lastError);
    }

    await sleep(config.indexer.pollIntervalMs);
  }
}

async function processNewBlocks(): Promise<void> {
  const rpc = getRpcClient();
  let syncState = syncQueries.get();
  
  // Get current chain tip
  const chainInfo = await rpc.getBlockchainInfo();
  const currentHeight = chainInfo.blocks;
  
  // Only process blocks with enough confirmations
  const targetHeight = currentHeight - config.indexer.minConfirmations;
  
  // Determine starting point - use configured start block if we haven't synced past it yet
  if (config.indexer.startBlock > 0 && syncState.last_block_height < config.indexer.startBlock) {
    console.log(`[Indexer] Skipping to configured start block ${config.indexer.startBlock}`);
    // Update sync state to skip ahead
    const skipBlock = await rpc.getBlockByHeight(config.indexer.startBlock - 1);
    syncQueries.update(config.indexer.startBlock - 1, skipBlock.hash);
    // Refresh sync state after update
    syncState = syncQueries.get();
  }
  
  if (targetHeight <= syncState.last_block_height) {
    // Nothing new to process
    return;
  }

  const startHeight = syncState.last_block_height + 1;
  console.log(`[Indexer] Processing blocks ${startHeight} to ${targetHeight}`);

  // Get fresh sync state for the loop
  let lastHash = syncState.last_block_hash;
  
  for (let height = startHeight; height <= targetHeight; height++) {
    const block = await rpc.getBlockByHeight(height);
    
    // Check for reorg (skip check for first block after genesis or initial sync)
    const isInitialSync = syncState.last_block_height === 0;
    if (!isInitialSync && height > 1 && block.previousblockhash !== lastHash) {
      console.log(`[Indexer] Reorg detected at height ${height}`);
      await handleReorg(block.previousblockhash);
      return; // Restart from new state
    }

    await processBlock(block);
    
    // Update sync state after each block
    syncQueries.update(height, block.hash);
    lastHash = block.hash;
    state.lastProcessedBlock = height;
    
    // Log progress every 1000 blocks
    if (height % 1000 === 0) {
      console.log(`[Indexer] Processed block ${height}/${targetHeight}`);
    }
  }
}

async function handleReorg(expectedPreviousHash: string): Promise<void> {
  const rpc = getRpcClient();
  const syncState = syncQueries.get();
  
  console.log('[Indexer] Finding common ancestor...');
  
  // Walk back until we find a common ancestor
  let currentHeight = syncState.last_block_height;
  let foundAncestor = false;
  
  while (currentHeight > 0 && !foundAncestor) {
    try {
      const block = await rpc.getBlockByHeight(currentHeight);
      // If this block exists and is part of main chain, we found our ancestor
      if (block.confirmations > 0) {
        foundAncestor = true;
        console.log(`[Indexer] Common ancestor found at height ${currentHeight}`);
        
        // Delete all agents indexed after this height
        agentQueries.deleteByBlockHeight(currentHeight + 1);
        
        // Update sync state
        syncQueries.update(currentHeight, block.hash);
        break;
      }
    } catch {
      // Block not found in main chain, continue walking back
    }
    currentHeight--;
  }

  if (!foundAncestor) {
    console.error('[Indexer] Could not find common ancestor, resetting to genesis');
    agentQueries.deleteByBlockHeight(0);
    syncQueries.update(0, '0'.repeat(64));
  }
}

async function processBlock(block: { hash: string; height: number; tx: string[]; time: number }): Promise<void> {
  const rpc = getRpcClient();
  
  for (const txid of block.tx) {
    try {
      await processTransaction(txid, block);
    } catch (err) {
      // Log but don't fail the whole block for one bad tx
      console.warn(`[Indexer] Failed to process tx ${txid}:`, err instanceof Error ? err.message : err);
    }
  }
}

async function processTransaction(
  txid: string,
  block: { hash: string; height: number; time: number }
): Promise<void> {
  const rpc = getRpcClient();
  
  try {
    const tx = await rpc.getTransaction(txid);
    
    // Look for identity updates with agent data
    for (const vout of tx.vout) {
      const identity = vout.scriptPubKey?.identityprimary;
      if (!identity) continue;
      if (!identity.contentmap && !identity.contentmultimap) continue;
      
      // Check if this identity has agent data (by known VDXF i-addresses)
      const hasAgent = hasAgentData(identity.contentmap, identity.contentmultimap);
      const hasService = hasServiceData(identity.contentmap, identity.contentmultimap);
      const hasReview = hasReviewData(identity.contentmap, identity.contentmultimap);
      
      if (!hasAgent && !hasService && !hasReview) continue;
      
      if (hasAgent) {
        console.log(`[Indexer] Found agent identity: ${identity.name}`);
        await indexAgentIdentity(identity, block);
      }
      
      if (hasService) {
        console.log(`[Indexer] Found service data: ${identity.name}`);
        await indexServiceData(identity, block);
      }
      
      if (hasReview) {
        console.log(`[Indexer] Found review data: ${identity.name}`);
        await indexReviewData(identity, block);
      }
    }
  } catch (err) {
    // Transaction might not be an identity update, that's fine
    if (!(err instanceof Error && err.message.includes('No information available'))) {
      throw err;
    }
  }
}

async function indexAgentIdentity(
  identity: {
    name: string;
    identityaddress: string;
    contentmap?: Record<string, string>;
    contentmultimap?: Record<string, string[]>;
  },
  block: { hash: string; height: number; time: number }
): Promise<void> {
  // Extract agent data from VDXF keys (by i-address)
  const agentData = extractAgentData(identity.contentmap, identity.contentmultimap);
  
  if (Object.keys(agentData).length === 0) return;
  
  // Add identity info
  agentData.owner = agentData.owner || identity.identityaddress;
  
  // Validate
  const parsed = parseAgentData(agentData);
  if (!parsed.success) {
    console.warn(`[Indexer] Invalid agent data for ${identity.name}: ${parsed.error}`);
    return;
  }
  
  const data = parsed.data;
  const db = getDatabase();
  
  // Use transaction for atomic insert
  const transaction = db.transaction(() => {
    // Check if agent already exists
    const existing = agentQueries.getById(identity.identityaddress);
    
    if (existing) {
      // Update existing agent
      agentQueries.update(identity.identityaddress, {
        name: data.name,
        type: data.type,
        description: data.description || null,
        status: data.status,
        revoked: data.revoked ? 1 : 0,  // Convert boolean to INTEGER for SQLite
        updated_at: data.updated || new Date().toISOString(),
        block_height: block.height,
        block_hash: block.hash,
      });
      
      // Update capabilities
      capabilityQueries.deleteByAgentId(existing.id);
      for (const cap of data.capabilities) {
        capabilityQueries.insert({
          agent_id: existing.id,
          capability_id: cap.id,
          name: cap.name,
          description: cap.description || null,
          protocol: cap.protocol,
          endpoint: cap.endpoint || null,
          public: cap.public ? 1 : 0,  // Convert boolean to INTEGER
          pricing_model: cap.pricing?.model || null,
          pricing_amount: cap.pricing?.amount ? parseFloat(cap.pricing.amount) : null,
          pricing_currency: cap.pricing?.currency || null,
        });
      }
      
      // Update endpoints
      endpointQueries.deleteByAgentId(existing.id);
      for (const ep of data.endpoints) {
        endpointQueries.insert({
          agent_id: existing.id,
          url: ep.url,
          protocol: ep.protocol,
          public: ep.public ? 1 : 0,  // Convert boolean to INTEGER
        });
      }
    } else {
      // Insert new agent
      const agentId = agentQueries.insert({
        verus_id: identity.identityaddress,
        name: data.name,
        type: data.type,
        description: data.description || null,
        owner: data.owner,
        status: data.status,
        revoked: data.revoked ? 1 : 0,  // Convert boolean to INTEGER for SQLite
        created_at: data.created || new Date().toISOString(),
        updated_at: data.updated || new Date().toISOString(),
        block_height: block.height,
        block_hash: block.hash,
        confirmation_count: 0,
      });
      
      // Insert capabilities
      for (const cap of data.capabilities) {
        capabilityQueries.insert({
          agent_id: agentId,
          capability_id: cap.id,
          name: cap.name,
          description: cap.description || null,
          protocol: cap.protocol,
          endpoint: cap.endpoint || null,
          public: cap.public ? 1 : 0,  // Convert boolean to INTEGER
          pricing_model: cap.pricing?.model || null,
          pricing_amount: cap.pricing?.amount ? parseFloat(cap.pricing.amount) : null,
          pricing_currency: cap.pricing?.currency || null,
        });
      }
      
      // Insert endpoints
      for (const ep of data.endpoints) {
        endpointQueries.insert({
          agent_id: agentId,
          url: ep.url,
          protocol: ep.protocol,
          public: ep.public ? 1 : 0,  // Convert boolean to INTEGER
        });
      }
    }
  });
  
  transaction();
  console.log(`[Indexer] Indexed agent: ${data.name} (${identity.identityaddress})`);
}

/**
 * Index service data from an identity's contentmultimap
 * Supports both individual service keys AND services stored as JSON array under ari::agent.v1.services
 */
async function indexServiceData(
  identity: {
    name: string;
    identityaddress: string;
    contentmap?: Record<string, string>;
    contentmultimap?: Record<string, string[]>;
  },
  block: { hash: string; height: number; time: number }
): Promise<void> {
  // Extract all services (handles both individual keys and JSON array format)
  const services = extractServicesArray(identity.contentmap, identity.contentmultimap);
  
  // Also try legacy single-service format
  if (services.length === 0) {
    const serviceData = extractServiceData(identity.contentmap, identity.contentmultimap);
    if (Object.keys(serviceData).length > 0) {
      services.push(serviceData);
    }
  }
  
  if (services.length === 0) return;
  
  // Find the associated agent
  const agent = agentQueries.getById(identity.identityaddress);
  if (!agent) {
    console.warn(`[Indexer] Service found for unregistered agent: ${identity.name}`);
    return;
  }
  
  const db = getDatabase();
  
  const transaction = db.transaction(() => {
    const existingServices = serviceQueries.getByAgentId(agent.id);
    const now = new Date().toISOString();
    
    for (const serviceData of services) {
      // Validate required fields
      const name = serviceData.name as string;
      const priceRaw = serviceData.price;
      const price = typeof priceRaw === 'string' ? parseFloat(priceRaw) : priceRaw as number;
      
      if (!name || price === undefined || isNaN(price)) {
        console.warn(`[Indexer] Invalid service data for ${identity.name}: missing/invalid name or price`);
        continue;
      }
      
      // Check if service already exists for this agent with this name
      const existing = existingServices.find(s => s.name === name);
      
      if (existing) {
        // Update existing service
        serviceQueries.update(existing.id, {
          description: (serviceData.description as string) || null,
          price: price,
          currency: (serviceData.currency as string) || 'VRSC',
          category: (serviceData.category as string) || null,
          turnaround: (serviceData.turnaround as string) || null,
          status: (serviceData.status as 'active' | 'inactive' | 'deprecated') || 'active',
          updated_at: now,
          block_height: block.height,
        });
        console.log(`[Indexer] Updated service: ${name} (${identity.identityaddress})`);
      } else {
        // Insert new service
        serviceQueries.insert({
          agent_id: agent.id,
          verus_id: identity.identityaddress,
          name: name,
          description: (serviceData.description as string) || null,
          price: price,
          currency: (serviceData.currency as string) || 'VRSC',
          category: (serviceData.category as string) || null,
          turnaround: (serviceData.turnaround as string) || null,
          status: (serviceData.status as 'active' | 'inactive' | 'deprecated') || 'active',
          created_at: now,
          updated_at: now,
          block_height: block.height,
        });
        console.log(`[Indexer] Indexed service: ${name} (${identity.identityaddress})`);
      }
    }
  });
  
  transaction();
}

/**
 * Index review data from an identity's contentmultimap
 * Reviews are stored under ari::review.v1.* keys
 * The identity storing the reviews is the AGENT (reviewed party)
 */
async function indexReviewData(
  identity: {
    name: string;
    identityaddress: string;
    contentmap?: Record<string, string>;
    contentmultimap?: Record<string, string[]>;
  },
  block: { hash: string; height: number; time: number }
): Promise<void> {
  const reviews = extractReviews(identity.contentmultimap);
  
  if (reviews.length === 0) return;
  
  // Find the associated agent (the one being reviewed)
  const agent = agentQueries.getById(identity.identityaddress);
  if (!agent) {
    console.warn(`[Indexer] Reviews found for unregistered agent: ${identity.name}`);
    return;
  }
  
  const db = getDatabase();
  
  const transaction = db.transaction(() => {
    for (const review of reviews) {
      const buyer = review.buyer as string;
      const jobHash = review.jobHash as string;
      const signature = review.signature as string;
      const timestamp = review.timestamp as number;
      
      // Validate required fields
      if (!buyer || !jobHash || !signature || !timestamp) {
        console.warn(`[Indexer] Invalid review data for ${identity.name}: missing required fields`);
        continue;
      }
      
      // Check if review already exists (by job hash)
      const existing = reviewQueries.getByJobHash(jobHash);
      if (existing) {
        // Reviews are immutable once stored, skip
        continue;
      }
      
      // Insert new review
      // Note: Signature verification happens in a separate process
      reviewQueries.insert({
        agent_id: agent.id,
        agent_verus_id: identity.identityaddress,
        buyer_verus_id: buyer,
        job_hash: jobHash,
        message: (review.message as string) || null,
        rating: (review.rating as number) || null,
        signature: signature,
        review_timestamp: timestamp,
        verified: false, // Will be verified by worker
        block_height: block.height,
      });
      
      console.log(`[Indexer] Indexed review for ${identity.name} from ${buyer}`);
    }
    
    // Recalculate reputation after adding reviews
    reputationQueries.recalculate(agent.id);
  });
  
  transaction();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
