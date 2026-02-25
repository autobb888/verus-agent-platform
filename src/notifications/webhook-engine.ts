/**
 * Webhook Delivery Engine (Phase 6d)
 * 
 * Delivers events to registered agent webhooks with:
 * - HMAC-SHA256 signature verification
 * - Exponential backoff retry (5 attempts)
 * - Auto-disable after 10 consecutive failures
 * - SSRF protection via ssrf-fetch
 */

import { createHmac } from 'crypto';
import { webhookQueries, webhookDeliveryQueries } from '../db/index.js';
import { ssrfSafeFetch } from '../utils/ssrf-fetch.js';
import { decryptSecret } from '../utils/crypto.js';

export type WebhookEventType = 
  | 'job.requested'
  | 'job.accepted'
  | 'job.payment'
  | 'job.in_progress'
  | 'job.delivered'
  | 'job.completed'
  | 'job.disputed'
  | 'job.cancelled'
  | 'job.started'
  | 'job.extension_request'
  | 'job.end_session_request'
  | 'message.new'
  | 'file.uploaded';

interface WebhookEvent {
  type: WebhookEventType;
  agentVerusId: string;
  data: Record<string, any>;
  jobId?: string;
}

/**
 * Queue a webhook event for delivery to all matching agent webhooks
 */
export function emitWebhookEvent(event: WebhookEvent): void {
  try {
    const hooks = webhookQueries.getActiveForEvent(event.agentVerusId, event.type);
    
    for (const hook of hooks) {
      const payload = JSON.stringify({
        event: event.type,
        timestamp: new Date().toISOString(),
        data: event.data,
        jobId: event.jobId,
      });

      webhookDeliveryQueries.insert({
        webhookId: hook.id,
        eventType: event.type,
        payload,
      });
    }
  } catch (err) {
    console.error('[Webhooks] Failed to queue event:', err);
  }
}

/**
 * Sign a payload with HMAC-SHA256
 */
function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Process pending webhook deliveries
 */
export async function processWebhookQueue(): Promise<number> {
  const pending = webhookDeliveryQueries.getPending(10);
  let delivered = 0;

  for (const delivery of pending) {
    try {
      const signature = signPayload(delivery.payload, decryptSecret(delivery.secret));

      const result = await ssrfSafeFetch(delivery.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': `sha256=${signature}`,
          'X-Webhook-Event': delivery.event_type,
          'User-Agent': 'VerusAgentPlatform/1.0',
        },
        body: delivery.payload,
        timeout: 10000,
        allowHttp: process.env.NODE_ENV !== 'production', // Allow http in dev
      });

      if (result.ok) {
        webhookDeliveryQueries.markDelivered(delivery.id);
        webhookQueries.recordSuccess(delivery.webhook_id);
        delivered++;
      } else {
        webhookDeliveryQueries.markFailed(delivery.id, `HTTP ${result.status}: ${(result.error || result.body).slice(0, 200)}`);
        webhookQueries.recordFailure(delivery.webhook_id);
      }
    } catch (err: any) {
      webhookDeliveryQueries.markFailed(delivery.id, err.message?.slice(0, 200) || 'Network error');
      webhookQueries.recordFailure(delivery.webhook_id);
    }
  }

  return delivered;
}

// Delivery loop interval
let deliveryInterval: ReturnType<typeof setInterval> | null = null;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

export function startWebhookEngine(): void {
  // Process queue every 5 seconds
  deliveryInterval = setInterval(async () => {
    try {
      await processWebhookQueue();
    } catch (err) {
      console.error('[Webhooks] Queue processing error:', err);
    }
  }, 5000);
  deliveryInterval.unref();

  // Cleanup old deliveries daily
  cleanupInterval = setInterval(() => {
    try {
      webhookDeliveryQueries.cleanup(7);
    } catch {}
  }, 24 * 60 * 60 * 1000);
  cleanupInterval.unref();

  console.log('[Webhooks] Delivery engine started');
}

export function stopWebhookEngine(): void {
  if (deliveryInterval) clearInterval(deliveryInterval);
  if (cleanupInterval) clearInterval(cleanupInterval);
  deliveryInterval = null;
  cleanupInterval = null;
}
