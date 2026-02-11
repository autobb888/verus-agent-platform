/**
 * SSRF-Protected Fetch
 * 
 * Shield AUTH-3: Prevents DNS rebinding attacks by resolving DNS first,
 * then fetching by resolved IP address.
 */

import { resolve4 } from 'dns/promises';
import { URL } from 'url';

// Blocked IP ranges (private, loopback, link-local)
const BLOCKED_RANGES = [
  { start: '127.0.0.0', end: '127.255.255.255' },     // Loopback
  { start: '10.0.0.0', end: '10.255.255.255' },       // Private Class A
  { start: '172.16.0.0', end: '172.31.255.255' },     // Private Class B
  { start: '192.168.0.0', end: '192.168.255.255' },   // Private Class C
  { start: '169.254.0.0', end: '169.254.255.255' },   // Link-local (AWS metadata!)
  { start: '0.0.0.0', end: '0.255.255.255' },         // Current network
];

// In production, only 80/443. Test ports only allowed in non-production with explicit flag.
// Shield: Double-guard prevents accidental misconfiguration in prod.
const ALLOWED_PORTS = (process.env.NODE_ENV !== 'production' && 
                       process.env.SSRF_ALLOW_TEST_PORTS === 'true')
  ? [80, 443, 3100, 3000, 8080]
  : [80, 443];

/**
 * Convert IP to numeric for range comparison (unsigned)
 */
function ipToNumber(ip: string): number {
  const parts = ip.split('.').map(Number);
  // Use >>> 0 for unsigned 32-bit (Shield fix: signed overflow)
  return ((parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

/**
 * Check if IPv4 address is in a blocked range
 */
function isBlockedIPv4(ip: string): boolean {
  const ipNum = ipToNumber(ip);
  
  for (const range of BLOCKED_RANGES) {
    const startNum = ipToNumber(range.start);
    const endNum = ipToNumber(range.end);
    if (ipNum >= startNum && ipNum <= endNum) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if IP is in a blocked range (IPv4 only for MVP)
 */
function isBlockedIP(ip: string): boolean {
  // Test mode: allow localhost only in non-production with explicit flag
  // Shield: Double-guard prevents accidental exposure in prod
  if (process.env.NODE_ENV !== 'production' && 
      process.env.SSRF_ALLOW_LOCALHOST === 'true' && 
      ip === '127.0.0.1') {
    console.warn('[SSRF] ⚠️ Localhost allowed (test mode only)');
    return false;
  }
  
  // Only IPv4 supported for MVP (Shield recommendation)
  if (!ip.includes('.') || ip.includes(':')) {
    return true; // Block non-IPv4
  }
  
  return isBlockedIPv4(ip);
}

/**
 * Validate a webhook URL against SSRF blocklists without fetching.
 * Returns null if safe, or an error message if blocked.
 */
export async function validateWebhookUrl(url: string): Promise<string | null> {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return 'Only http/https URLs are allowed';
    }
    const port = parsed.port ? parseInt(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80);
    if (!ALLOWED_PORTS.includes(port)) {
      return `Port ${port} is not allowed`;
    }
    // Resolve and check IP
    const ips = await resolve4(parsed.hostname);
    if (!ips.length) return 'Could not resolve hostname';
    for (const ip of ips) {
      if (isBlockedIP(ip)) return `Hostname resolves to blocked IP range`;
    }
    return null;
  } catch (err: any) {
    if (err.code === 'ENOTFOUND') return 'Could not resolve hostname';
    return err.message || 'Invalid URL';
  }
}

export interface SSRFFetchOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
  allowHttp?: boolean;  // For dev only
}

export interface SSRFFetchResult {
  ok: boolean;
  status: number;
  body: string;
  error?: string;
}

/**
 * Fetch URL with SSRF protection
 * 
 * 1. Parse URL, validate port
 * 2. Resolve DNS to get IP
 * 3. Check IP against blocked ranges
 * 4. Fetch using resolved IP (prevents DNS rebinding)
 * 5. Don't follow redirects
 */
export async function ssrfSafeFetch(
  url: string,
  options: SSRFFetchOptions = {}
): Promise<SSRFFetchResult> {
  const {
    method = 'GET',
    headers = {},
    body,
    timeout = 10000,
    allowHttp = process.env.NODE_ENV !== 'production',
  } = options;

  try {
    // 1. Parse URL
    const parsed = new URL(url);
    
    // 2. Validate protocol
    if (parsed.protocol === 'http:' && !allowHttp) {
      return { ok: false, status: 0, body: '', error: 'HTTPS required in production' };
    }
    
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, status: 0, body: '', error: 'Only HTTP(S) allowed' };
    }
    
    // 3. Validate port
    const port = parsed.port 
      ? parseInt(parsed.port) 
      : (parsed.protocol === 'https:' ? 443 : 80);
    
    if (!ALLOWED_PORTS.includes(port)) {
      return { ok: false, status: 0, body: '', error: `Port ${port} not allowed` };
    }
    
    // 4. Resolve DNS or use direct IP (IPv4 only for MVP - Shield recommendation)
    let resolvedIp: string;
    
    // Check if hostname is already a valid IPv4 address
    // Shield: Validate octet range (0-255) to prevent invalid IPs like 999.999.999.999
    const isValidIPv4 = (hostname: string): boolean => {
      const parts = hostname.split('.');
      if (parts.length !== 4) return false;
      return parts.every(p => {
        const n = parseInt(p, 10);
        return n >= 0 && n <= 255 && p === String(n); // No leading zeros
      });
    };
    
    // Shield fix: localhost is in /etc/hosts, not DNS - resolve4() won't find it
    // Handle as special case, then let isBlockedIP() enforce test flags
    if (parsed.hostname === 'localhost' || parsed.hostname === 'localhost.localdomain') {
      resolvedIp = '127.0.0.1';
    } else if (isValidIPv4(parsed.hostname)) {
      resolvedIp = parsed.hostname;
    } else {
      try {
        const ips = await resolve4(parsed.hostname);
        if (ips.length === 0) {
          return { ok: false, status: 0, body: '', error: 'No IPv4 address found (IPv6 not supported)' };
        }
        resolvedIp = ips[0];
      } catch (err) {
        return { ok: false, status: 0, body: '', error: 'DNS resolution failed (IPv4 required)' };
      }
    }
    
    // 5. Check IP against blocked ranges (Shield AUTH-3)
    if (isBlockedIP(resolvedIp)) {
      return { ok: false, status: 0, body: '', error: 'IP address blocked (private/internal)' };
    }
    
    // 6. Build fetch URL using resolved IP (prevents DNS rebinding)
    const fetchUrl = `${parsed.protocol}//${resolvedIp}:${port}${parsed.pathname}${parsed.search}`;
    
    // 7. Fetch with Host header for virtual hosting
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(fetchUrl, {
        method,
        headers: {
          'Host': parsed.hostname,
          'User-Agent': 'Verus-Agent-Platform/1.0',
          ...headers,
        },
        body: method === 'POST' ? body : undefined,
        redirect: 'error',  // Don't follow redirects
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      const responseBody = await response.text();
      
      return {
        ok: response.ok,
        status: response.status,
        body: responseBody,
      };
      
    } catch (err: any) {
      clearTimeout(timeoutId);
      
      if (err.name === 'AbortError') {
        return { ok: false, status: 0, body: '', error: 'Request timeout' };
      }
      
      // Redirect error
      if (err.message?.includes('redirect')) {
        return { ok: false, status: 0, body: '', error: 'Redirects not allowed' };
      }
      
      return { ok: false, status: 0, body: '', error: err.message || 'Fetch failed' };
    }
    
  } catch (err: any) {
    return { ok: false, status: 0, body: '', error: err.message || 'Invalid URL' };
  }
}
