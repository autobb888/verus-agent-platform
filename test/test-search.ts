/**
 * Test Search API
 */

import { initDatabase, getDatabase } from '../src/db/index.js';
import { createServer } from '../src/api/server.js';
import { v4 as uuidv4 } from 'uuid';

async function test() {
  console.log('=== Search API Test ===\n');
  
  initDatabase();
  const db = getDatabase();
  
  // Create test agents
  console.log('1. Creating test agents...');
  const agents = [
    { name: 'Image Generator Pro', type: 'autonomous', description: 'Generates high-quality images from text prompts using AI' },
    { name: 'Code Assistant', type: 'assisted', description: 'Helps developers write and review code' },
    { name: 'Data Analyzer', type: 'autonomous', description: 'Analyzes datasets and generates insights' },
    { name: 'Translation Bot', type: 'tool', description: 'Translates text between languages' },
  ];
  
  const agentIds: string[] = [];
  for (const agent of agents) {
    const id = uuidv4();
    agentIds.push(id);
    db.prepare(`
      INSERT INTO agents (id, verus_id, name, type, description, owner, status, block_height, block_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', 0, 'test', datetime('now'), datetime('now'))
    `).run(id, `iTest${Date.now()}${Math.random()}`, agent.name, agent.type, agent.description, 'test@');
  }
  console.log(`   Created ${agents.length} test agents`);
  
  // Add capabilities
  console.log('2. Adding capabilities...');
  db.prepare(`
    INSERT INTO agent_capabilities (id, agent_id, capability_id, name, protocol)
    VALUES (?, ?, 'image-generation', 'Image Generation', 'MCP')
  `).run(uuidv4(), agentIds[0]);
  
  db.prepare(`
    INSERT INTO agent_capabilities (id, agent_id, capability_id, name, protocol)
    VALUES (?, ?, 'code-review', 'Code Review', 'REST')
  `).run(uuidv4(), agentIds[1]);
  
  const server = await createServer();
  await server.listen({ port: 3300, host: '127.0.0.1' });
  
  const baseUrl = 'http://127.0.0.1:3300';
  
  // Test searches
  console.log('\n3. Testing searches...\n');
  
  // Search by text
  console.log('   Search: q=image');
  let res = await fetch(`${baseUrl}/v1/search?q=image`);
  let data = await res.json() as any;
  console.log(`   Results: ${data.data.length} agents found`);
  console.log(`   First: ${data.data[0]?.name || 'none'}`);
  
  // Search by type
  console.log('\n   Search: type=autonomous');
  res = await fetch(`${baseUrl}/v1/search?type=autonomous`);
  data = await res.json() as any;
  console.log(`   Results: ${data.data.length} agents found`);
  
  // Search by capability
  console.log('\n   Search: capability=image-generation');
  res = await fetch(`${baseUrl}/v1/search?capability=image-generation`);
  data = await res.json() as any;
  console.log(`   Results: ${data.data.length} agents found`);
  
  // Search by protocol
  console.log('\n   Search: protocol=MCP');
  res = await fetch(`${baseUrl}/v1/search?protocol=MCP`);
  data = await res.json() as any;
  console.log(`   Results: ${data.data.length} agents found`);
  
  // Combined search
  console.log('\n   Search: q=code&type=assisted');
  res = await fetch(`${baseUrl}/v1/search?q=code&type=assisted`);
  data = await res.json() as any;
  console.log(`   Results: ${data.data.length} agents found`);
  console.log(`   Match: ${data.data[0]?.name || 'none'}`);
  
  // Test suggestions
  console.log('\n4. Testing suggestions...');
  res = await fetch(`${baseUrl}/v1/search/suggest?q=ima`);
  data = await res.json() as any;
  console.log(`   Agent suggestions: ${data.data.agents?.join(', ') || 'none'}`);
  console.log(`   Capability suggestions: ${data.data.capabilities?.map((c: any) => c.name).join(', ') || 'none'}`);
  
  // Cleanup
  for (const id of agentIds) {
    db.prepare('DELETE FROM agents WHERE id = ?').run(id);
  }
  
  await server.close();
  console.log('\n✅ SEARCH TEST PASSED!');
  process.exit(0);
}

test().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
