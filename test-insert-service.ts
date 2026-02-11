/**
 * Test inserting services for ari@
 */
import { initDatabase, agentQueries, serviceQueries, getDatabase } from './src/db/index.js';
import { getRpcClient } from './src/indexer/rpc-client.js';
import { extractServicesArray } from './src/validation/vdxf-keys.js';

initDatabase();

const rpc = getRpcClient();

async function test() {
  const identity = await rpc.getIdentity('ari@');
  console.log('Identity:', identity.identity.name);
  
  // Find the agent
  const agent = agentQueries.getById(identity.identity.identityaddress);
  console.log('Agent found:', agent ? 'yes' : 'no');
  console.log('Agent id:', agent?.id);
  console.log('Agent internal_id:', (agent as any)?.internal_id);
  
  if (!agent) {
    console.error('Agent not found!');
    return;
  }
  
  // Extract services
  const services = extractServicesArray(identity.identity.contentmap, identity.identity.contentmultimap);
  console.log('Services count:', services.length);
  
  const now = new Date().toISOString();
  const block = { height: 926568, hash: 'test', time: Date.now() };
  
  for (const serviceData of services) {
    const name = serviceData.name as string;
    const priceRaw = serviceData.price;
    const price = typeof priceRaw === 'string' ? parseFloat(priceRaw) : priceRaw as number;
    
    console.log('\n--- Inserting service ---');
    console.log('Name:', name);
    console.log('Price:', price, typeof price);
    
    const insertData = {
      agent_id: agent.id,
      verus_id: identity.identity.identityaddress,
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
    };
    
    console.log('Insert data:', JSON.stringify(insertData, null, 2));
    
    // Check for any undefined or object values
    for (const [key, value] of Object.entries(insertData)) {
      const type = typeof value;
      if (type === 'undefined') {
        console.error(`ERROR: ${key} is undefined!`);
      } else if (type === 'object' && value !== null) {
        console.error(`ERROR: ${key} is an object:`, value);
      }
    }
    
    try {
      const id = serviceQueries.insert(insertData);
      console.log('Inserted service with id:', id);
    } catch (err) {
      console.error('Insert error:', err);
    }
  }
  
  // Check what's in the database
  console.log('\n--- Services in database ---');
  const allServices = serviceQueries.getAll({});
  console.log('Count:', allServices.length);
  for (const s of allServices) {
    console.log(`- ${s.name}: ${s.price} ${s.currency}`);
  }
}

test().catch(console.error);
