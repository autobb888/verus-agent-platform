/**
 * Mock Agent Endpoint Server
 * 
 * Simulates an agent's endpoint for testing verification flow.
 * Stores challenge tokens and returns them on GET.
 */

import Fastify from 'fastify';

const fastify = Fastify({ logger: true });

// Store challenges by verusId
const challenges = new Map<string, { token: string; timestamp: number }>();

// POST /.well-known/verus-agent - Receive challenge
fastify.post('/.well-known/verus-agent', async (request, reply) => {
  const body = request.body as any;
  
  console.log('[Mock] Received challenge:', body);
  
  if (body.action === 'challenge' && body.token && body.verusId) {
    challenges.set(body.verusId, {
      token: body.token,
      timestamp: body.timestamp,
    });
    
    return { status: 'ok', message: 'Challenge stored' };
  }
  
  return reply.code(400).send({ error: 'Invalid challenge format' });
});

// GET /.well-known/verus-agent - Return stored challenge
fastify.get('/.well-known/verus-agent', async (request, reply) => {
  // Return the most recent challenge (for testing)
  const entries = Array.from(challenges.entries());
  
  if (entries.length === 0) {
    return reply.code(404).send({ error: 'No challenge stored' });
  }
  
  const [verusId, challenge] = entries[entries.length - 1];
  
  console.log('[Mock] Returning challenge for:', verusId);
  
  return {
    verusId,
    token: challenge.token,
    timestamp: challenge.timestamp,
  };
});

// Health check
fastify.get('/health', async () => ({ status: 'ok' }));

// Start server
const start = async () => {
  try {
    await fastify.listen({ port: 3100, host: '0.0.0.0' });
    console.log('[Mock Endpoint] Running on http://localhost:3100');
    console.log('[Mock Endpoint] Challenge endpoint: http://localhost:3100/.well-known/verus-agent');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
