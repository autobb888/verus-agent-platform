import { HttpClient } from '../core/http.js';

export class JobsClient {
  constructor(private http: HttpClient) {}

  /** Create a job request (buyer) */
  async create(params: {
    sellerVerusId: string;
    serviceId?: number;
    description: string;
    amount: number;
    currency?: string;
    deadline?: string;
    paymentTerms?: 'prepay' | 'postpay';
    paymentAddress?: string;
    timestamp: number;
    signature: string;
  }) {
    return this.http.post('/v1/jobs', params);
  }

  /** Get job by ID */
  async get(id: number) {
    return this.http.get(`/v1/jobs/${id}`);
  }

  /** Get job by hash */
  async getByHash(hash: string) {
    return this.http.get(`/v1/jobs/hash/${encodeURIComponent(hash)}`);
  }

  /** Get my jobs (authenticated) */
  async mine(params?: { status?: string; role?: 'buyer' | 'seller' }) {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.role) query.set('role', params.role);
    const qs = query.toString();
    return this.http.get(`/v1/me/jobs${qs ? `?${qs}` : ''}`);
  }

  /** Accept a job (seller) */
  async accept(id: number, params: { timestamp: number; signature: string }) {
    return this.http.post(`/v1/jobs/${id}/accept`, params);
  }

  /** Mark job as delivered (seller) */
  async deliver(id: number, params: { timestamp: number; signature: string; deliverable?: string }) {
    return this.http.post(`/v1/jobs/${id}/deliver`, params);
  }

  /** Complete a job (buyer) */
  async complete(id: number, params: { timestamp: number; signature: string }) {
    return this.http.post(`/v1/jobs/${id}/complete`, params);
  }

  /** Dispute a job */
  async dispute(id: number, params: { reason: string }) {
    return this.http.post(`/v1/jobs/${id}/dispute`, params);
  }

  /** Cancel a job */
  async cancel(id: number, params: { reason?: string }) {
    return this.http.post(`/v1/jobs/${id}/cancel`, params);
  }

  /** Record payment for a job */
  async recordPayment(id: number, params: { paymentTxid: string }) {
    return this.http.post(`/v1/jobs/${id}/payment`, params);
  }

  /** Get messages for a job */
  async getMessages(id: number) {
    return this.http.get(`/v1/jobs/${id}/messages`);
  }

  /** Send a message on a job */
  async sendMessage(id: number, params: { content: string; signature?: string }) {
    return this.http.post(`/v1/jobs/${id}/messages`, params);
  }

  /** Get the sign message template for a job request */
  async getSignMessage(params: {
    sellerVerusId: string;
    description: string;
    amount: number;
    currency?: string;
    deadline?: string;
  }) {
    const query = new URLSearchParams({
      sellerVerusId: params.sellerVerusId,
      description: params.description,
      amount: String(params.amount),
    });
    if (params.currency) query.set('currency', params.currency);
    if (params.deadline) query.set('deadline', params.deadline);
    return this.http.get(`/v1/jobs/message/request?${query}`);
  }
}
