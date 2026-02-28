/**
 * HTTP client for API requests
 */

import type { ApiError, ClientConfig } from '../types/index.js';

export class HttpClient {
  private baseUrl: string;
  private timeout: number;
  private headers: Record<string, string>;
  private cookies: string[] = [];
  private onAuthError?: () => Promise<void>;
  private retrying = false;

  constructor(config: ClientConfig) {
    // Validate baseUrl protocol to prevent file:// SSRF
    const parsed = new URL(config.baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('baseUrl must use http:// or https:// protocol');
    }
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
   * Set callback for automatic re-authentication on 401/403
   */
  setOnAuthError(callback: () => Promise<void>): void {
    this.onAuthError = callback;
  }

  /**
   * Resolve a relative path against baseUrl, rejecting absolute URLs and protocol-relative paths.
   */
  private resolveUrl(path: string): URL {
    if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//')) {
      throw new PlatformError('Absolute URLs are not allowed as path', 'INVALID_PATH', 0);
    }
    return new URL(path, this.baseUrl);
  }

  /**
   * Make a GET request
   */
  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = this.resolveUrl(path);
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
    const url = this.resolveUrl(path);
    return this.request<T>('POST', url.toString(), body);
  }

  /**
   * Make a PUT request
   */
  async put<T>(path: string, body?: unknown): Promise<T> {
    const url = this.resolveUrl(path);
    return this.request<T>('PUT', url.toString(), body);
  }

  /**
   * Make a DELETE request
   */
  async delete<T>(path: string): Promise<T> {
    const url = this.resolveUrl(path);
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

      let data: unknown;
      try {
        data = await response.json();
      } catch {
        throw new PlatformError(
          `Invalid JSON response (status ${response.status})`,
          'PARSE_ERROR',
          response.status
        );
      }

      if (!response.ok) {
        const error = data as ApiError;
        const statusCode = response.status;

        // Auto-reauth: on 401/403, call onAuthError callback and retry once
        if ((statusCode === 401 || statusCode === 403) && this.onAuthError && !this.retrying) {
          this.retrying = true;
          try {
            await this.onAuthError();
            return await this.request<T>(method, url, body);
          } finally {
            this.retrying = false;
          }
        }

        throw new PlatformError(
          error.error?.message || 'Request failed',
          error.error?.code || 'UNKNOWN_ERROR',
          statusCode
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
        throw new PlatformError('Request failed', 'NETWORK_ERROR', 0);
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
