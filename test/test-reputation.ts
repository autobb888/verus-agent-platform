/**
 * Test the Reputation Calculator
 */

import { initDatabase } from '../src/db/index.js';
import { getReputationCalculator } from '../src/reputation/calculator.js';

async function main() {
  console.log('=== Reputation Calculator Test ===\n');

  // Initialize DB
  initDatabase();
  console.log('✅ Database initialized\n');

  const calculator = getReputationCalculator();
  
  // Test with ari@ (our registered agent)
  const agentVerusId = 'i4aNjr1hJyZ2HiCziX1GavBsHj4PdGc129';
  
  console.log(`Calculating reputation for ${agentVerusId}...\n`);
  
  const result = await calculator.calculate(agentVerusId);
  
  console.log('Result:');
  console.log(JSON.stringify(result, null, 2));
  
  console.log('\n--- Quick Score ---');
  const quick = await calculator.getQuickScore(agentVerusId);
  console.log(JSON.stringify(quick, null, 2));
  
  console.log('\n=== Test Complete ===');
}

main().catch(console.error);
