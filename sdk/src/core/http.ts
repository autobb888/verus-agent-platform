/**
 * HTTP client for API requests
 */

import type { ApiError, ClientConfig } from '../types/index.js';

export class HttpClient {
  private baseUrl: string;
  private timeout: number;
  private headers: Record<string, string>;
  private cookies: string[] = [];

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.timeout = config.timeout || 30000;
    this.headers = {
      'Content-Type': 'application/json',
      ...config.headers,
    };
  }

  /**
   * Set session cookie for authenticated requests
   */
  setSessionCookie(cookie: string): void {
    this.cookies = [cookie];
  }

  /**
   * Clear session cookie
   */
  clearSession(): void {
    this.cookies = [];
  }

  /**
   * Make a GET request
   */
  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(path, this.baseUrl);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }
    return this.request<T>('GET', url.toString());
  }

  /**
   * Make a POST request
   */
  async post<T>(path: string, body?: unknown): Promise<T> {
    const url = new URL(path, this.baseUrl);
    return this.request<T>('POST', url.toString(), body);
  }

  /**
   * Make a PUT request
   */
  async put<T>(path: string, body?: unknown): Promise<T> {
    const url = new URL(path, this.baseUrl);
    return this.request<T>('PUT', url.toString(), body);
  }

  /**
   * Make a DELETE request
   */
  async delete<T>(path: string): Promise<T> {
    const url = new URL(path, this.baseUrl);
    return this.request<T>('DELETE', url.toString());
  }

  /**
   * Internal request method
   */
  private async request<T>(
    method: string,
    url: string,
    body?: unknown
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const headers: Record<string, string> = { ...this.headers };
      
      if (this.cookies.length > 0) {
        headers['Cookie'] = this.cookies.join('; ');
      }

      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        credentials: 'include',
      });

      clearTimeout(timeoutId);

      // Extract set-cookie header for session management
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) {
        this.cookies = [setCookie.split(';')[0]];
      }

      const data = await response.json();

      if (!response.ok) {
        const error = data as ApiError;
        throw new PlatformError(
          error.error?.message || 'Request failed',
          error.error?.code || 'UNKNOWN_ERROR',
          response.status
        );
      }

      return data as T;
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof PlatformError) {
        throw error;
      }
      
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new PlatformError('Request timeout', 'TIMEOUT', 408);
        }
        throw new PlatformError(error.message, 'NETWORK_ERROR', 0);
      }
      
      throw new PlatformError('Unknown error', 'UNKNOWN_ERROR', 0);
    }
  }
}

/**
 * Platform API error
 */
export class PlatformError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = 'PlatformError';
  }
}
