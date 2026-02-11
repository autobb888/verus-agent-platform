/**
 * Test agent parsing for alice
 */
import { initDatabase } from './src/db/index.js';
import { getRpcClient } from './src/indexer/rpc-client.js';
import { extractAgentData } from './src/validation/vdxf-keys.js';
import { parseAgentData } from './src/validation/vdxf-schema.js';

initDatabase();

const rpc = getRpcClient();

async function test() {
  const identity = await rpc.getIdentity('alice.agentplatform@');
  console.log('Identity:', identity.identity.name);
  
  const agentData = extractAgentData(identity.identity.contentmap, identity.identity.contentmultimap);
  console.log('\nExtracted agent data:', JSON.stringify(agentData, null, 2));
  
  // Add owner if missing
  agentData.owner = agentData.owner || identity.identity.identityaddress;
  
  const parsed = parseAgentData(agentData);
  if (!parsed.success) {
    console.error('\nParse error:', parsed.error);
    return;
  }
  
  console.log('\nParsed data:', JSON.stringify(parsed.data, null, 2));
  
  // Check each field type
  for (const [key, value] of Object.entries(parsed.data)) {
    const type = typeof value;
    if (type === 'object' && value !== null) {
      console.log(`Field ${key}: ${type}`, Array.isArray(value) ? `(array of ${value.length})` : '');
      if (Array.isArray(value) && value.length > 0) {
        console.log(`  First item:`, JSON.stringify(value[0]));
      }
    }
  }
}

test().catch(console.error);
