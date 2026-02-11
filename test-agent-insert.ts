/**
 * Test inserting/updating alice agent
 */
import { initDatabase, agentQueries, getDatabase } from './src/db/index.js';
import { getRpcClient } from './src/indexer/rpc-client.js';
import { extractAgentData } from './src/validation/vdxf-keys.js';
import { parseAgentData } from './src/validation/vdxf-schema.js';

initDatabase();

const rpc = getRpcClient();

async function test() {
  const identity = await rpc.getIdentity('alice.agentplatform@');
  console.log('Identity:', identity.identity.name);
  
  const agentData = extractAgentData(identity.identity.contentmap, identity.identity.contentmultimap);
  agentData.owner = agentData.owner || identity.identity.identityaddress;
  
  const parsed = parseAgentData(agentData);
  if (!parsed.success) {
    console.error('Parse error:', parsed.error);
    return;
  }
  
  const data = parsed.data;
  const block = { height: 926665, hash: 'test', time: Date.now() };
  
  // Check if agent exists
  const existing = agentQueries.getById(identity.identity.identityaddress);
  console.log('Agent exists:', !!existing);
  
  if (existing) {
    console.log('Attempting update...');
    const updateData = {
      name: data.name,
      type: data.type,
      description: data.description || null,
      status: data.status,
      revoked: data.revoked,
      updated_at: data.updated || new Date().toISOString(),
      block_height: block.height,
      block_hash: block.hash,
    };
    console.log('Update data:', JSON.stringify(updateData, null, 2));
    
    // Check each field
    for (const [key, value] of Object.entries(updateData)) {
      const type = typeof value;
      if (type === 'object' && value !== null) {
        console.error(`ERROR: ${key} is an object:`, value);
      } else if (type === 'undefined') {
        console.error(`ERROR: ${key} is undefined`);
      }
    }
    
    try {
      agentQueries.update(identity.identity.identityaddress, updateData);
      console.log('Update succeeded!');
    } catch (err) {
      console.error('Update failed:', err);
    }
  }
}

test().catch(console.error);
