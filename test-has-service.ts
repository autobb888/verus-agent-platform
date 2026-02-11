/**
 * Test hasServiceData detection
 */
import { initDatabase } from './src/db/index.js';
import { getRpcClient } from './src/indexer/rpc-client.js';
import { hasServiceData, hasAgentData, extractServicesArray } from './src/validation/vdxf-keys.js';

initDatabase();

const rpc = getRpcClient();

async function test() {
  const identities = ['ari@', 'alice.agentplatform@', 'bob.agentplatform@'];
  
  for (const name of identities) {
    console.log(`\n=== ${name} ===`);
    try {
      const identity = await rpc.getIdentity(name);
      const { contentmap, contentmultimap } = identity.identity;
      
      console.log('Has agent data:', hasAgentData(contentmap, contentmultimap));
      console.log('Has service data:', hasServiceData(contentmap, contentmultimap));
      
      // Check for services key directly
      const servicesKey = 'iPpTtEbDj79FMMScKyfjSyhjJbSyaeXLHe';
      console.log('Services key in contentmultimap:', !!contentmultimap?.[servicesKey]);
      console.log('Services count:', contentmultimap?.[servicesKey]?.length || 0);
      
      // Extract services
      const services = extractServicesArray(contentmap, contentmultimap);
      console.log('Extracted services:', services.length);
      for (const s of services) {
        console.log(`  - ${s.name}: ${s.price} ${s.currency}`);
      }
    } catch (err) {
      console.error('Error:', err);
    }
  }
}

test().catch(console.error);
