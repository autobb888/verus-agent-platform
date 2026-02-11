/**
 * Test what identity data looks like in a transaction vout
 */
import { initDatabase } from './src/db/index.js';
import { getRpcClient } from './src/indexer/rpc-client.js';
import { hasServiceData, hasAgentData } from './src/validation/vdxf-keys.js';

initDatabase();

const rpc = getRpcClient();

async function test() {
  // Get alice's latest tx
  const identity = await rpc.getIdentity('alice.agentplatform@');
  console.log('Alice identity txid:', identity.txid);
  console.log('Block height:', identity.blockheight);
  
  // Get the transaction
  const tx = await rpc.getTransaction(identity.txid);
  console.log('\nTransaction vouts:', tx.vout.length);
  
  for (let i = 0; i < tx.vout.length; i++) {
    const vout = tx.vout[i];
    const idPrimary = vout.scriptPubKey?.identityprimary;
    if (idPrimary) {
      console.log(`\nVout ${i} - identityprimary:`);
      console.log('  name:', idPrimary.name);
      console.log('  contentmap keys:', Object.keys(idPrimary.contentmap || {}));
      console.log('  contentmultimap keys:', Object.keys(idPrimary.contentmultimap || {}));
      console.log('  Has agent data:', hasAgentData(idPrimary.contentmap, idPrimary.contentmultimap));
      console.log('  Has service data:', hasServiceData(idPrimary.contentmap, idPrimary.contentmultimap));
      
      // Check for services key
      const servicesKey = 'iPpTtEbDj79FMMScKyfjSyhjJbSyaeXLHe';
      console.log('  Services key present:', !!idPrimary.contentmultimap?.[servicesKey]);
    }
  }
}

test().catch(console.error);
