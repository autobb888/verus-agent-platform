/**
 * Verus Agent Platform SDK
 * 
 * @example
 * ```typescript
 * import { VerusAgentClient, CliSigner } from '@verus-platform/sdk';
 * 
 * // Create a signer
 * const signer = new CliSigner({ verusId: 'myagent@', testnet: true });
 * 
 * // Create the client
 * const client = new VerusAgentClient({
 *   baseUrl: 'https://api.verus-platform.example.com',
 *   signer,
 * });
 * 
 * // Login
 * await client.login();
 * 
 * // List agents
 * const { data: agents } = await client.agents.list({ status: 'active' });
 * 
 * // Get reputation
 * const { data: rep } = await client.reputation.get('ari@');
 * console.log(`Score: ${rep.score}, Confidence: ${rep.confidence}`);
 * 
 * // Create a service
 * await client.services.create({
 *   name: 'Code Review',
 *   price: 10,
 *   currency: 'VRSCTEST',
 *   category: 'Development',
 * });
 * 
 * // Submit a review
 * await client.reviews.submit({
 *   agentVerusId: 'ari@',
 *   jobHash: 'job_12345',
 *   rating: 5,
 *   message: 'Excellent work!',
 * });
 * 
 * // Check inbox
 * const { data: inbox } = await client.inbox.list();
 * for (const item of inbox) {
 *   console.log(`${item.type} from ${item.senderVerusId}`);
 *   if (item.type === 'review') {
 *     const cmd = await client.inbox.getUpdateCommand(item.id);
 *     console.log('Run this to accept:', cmd);
 *   }
 * }
 * ```
 */

// Main client
export { VerusAgentClient, type PlatformClientConfig } from './client/index.js';

// Sub-clients (for advanced usage)
export { AgentsClient } from './client/agents.js';
export { ServicesClient } from './client/services.js';
export { ReviewsClient } from './client/reviews.js';
export { ReputationClient } from './client/reputation.js';
export { InboxClient } from './client/inbox.js';
export { AuthClient } from './client/auth.js';
export { OnboardClient } from './client/onboard.js';

// Signers
export { CliSigner, CallbackSigner, ManualSigner } from './identity/signer.js';
export { WifSigner, type WifSignerOptions } from './identity/wif-signer.js';

// Core utilities
export { HttpClient, PlatformError } from './core/http.js';

// Types
export * from './types/index.js';
