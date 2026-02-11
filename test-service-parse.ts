/**
 * Test service parsing from ari@ identity
 */
import { initDatabase } from './src/db/index.js';
import { getRpcClient } from './src/indexer/rpc-client.js';
import { hasServiceData, extractServicesArray, parseVdxfValue } from './src/validation/vdxf-keys.js';

initDatabase();

const rpc = getRpcClient();

async function test() {
  const identity = await rpc.getIdentity('ari@');
  console.log('Identity:', identity.identity.name);
  console.log('Has service data:', hasServiceData(identity.identity.contentmap, identity.identity.contentmultimap));
  
  const servicesKey = 'iPpTtEbDj79FMMScKyfjSyhjJbSyaeXLHe';
  const rawServices = identity.identity.contentmultimap?.[servicesKey];
  console.log('Raw services count:', rawServices?.length);
  
  if (rawServices) {
    for (let i = 0; i < rawServices.length; i++) {
      console.log(`\n--- Service ${i + 1} ---`);
      console.log('Hex:', rawServices[i].substring(0, 50) + '...');
      const parsed = parseVdxfValue(rawServices[i]);
      console.log('Parsed:', JSON.stringify(parsed, null, 2));
      console.log('Type of parsed:', typeof parsed);
      if (typeof parsed === 'object' && parsed !== null) {
        for (const [key, value] of Object.entries(parsed)) {
          console.log(`  ${key}: ${typeof value} = ${JSON.stringify(value)}`);
        }
      }
    }
  }
  
  const services = extractServicesArray(identity.identity.contentmap, identity.identity.contentmultimap);
  console.log('\n--- Extracted services ---');
  console.log('Count:', services.length);
  for (const service of services) {
    console.log('Service:', JSON.stringify(service));
  }
}

test().catch(console.error);
