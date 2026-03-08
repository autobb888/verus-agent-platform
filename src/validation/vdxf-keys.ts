// AgentPlatform Schema Keys (VerusID-based)
// Keys are discovered dynamically from the agentplatform@ identity on-chain.
// The contentmultimap of agentplatform@ maps each VDXF i-address to its
// human-readable key name (e.g. "agentplatform::agent.v1.name").
// Hardcoded defaults are used as fallback if the chain is unreachable at startup.

// --- Schema key maps (field name -> i-address) ---
// These are populated by loadSchemaFromChain() or fall back to defaults.

let AGENT_KEYS: Record<string, string> = {
  'version': 'iBShCc1dESnTq25WkxzrKGjHvHwZFSoq6b',
  'type': 'i9YN6ovGcotCnFdNyUtNh72Nw11WcBuD8y',
  'name': 'i3oa8uNjgZjmC1RS8rg1od8czBP8bsh5A8',
  'description': 'i9Ww2jR4sFt7nzdc5vRy5MHUCjTWULXCqH',
  'status': 'iNCvffXEYWNBt1K5izxKFSFKBR5LPAAfxW',
  'capabilities': 'i7Aumh6Akeq7SC8VJBzpmJrqKNCvREAWMA',
  'endpoints': 'i9n5Vu8fjXLP5CxzcdpwHbSzaW22dJxvHc',
  'protocols': 'iFQzXU4V6am1M9q6LGBfR4uyNAtjhJiW2d',
  'owner': 'i5uUotnF2LzPci3mkz9QaozBtFjeFtAw45',
  'services': 'iGVUNBQSNeGzdwjA4km5z6R9h7T2jao9Lz',
  'tags': 'iJ3Vh2auC5VRbTKtjvKr9tWg515xAHKzN7',
  'website': 'iMGHWAQgGM4VSDfsRTHwBipbwMemt9WdP8',
  'avatar': 'iR5a34uDHJLquQgvffXWZ7pSU8spiFEgzh',
  'category': 'iGzkSnpGYjTy3eG2FakUDQrXgFMGyCvTGi',
};

let SERVICE_KEYS: Record<string, string> = {
  'name': 'iNTrSV1bqDAoaGRcpR51BeoS5wQvQ4P9Qj',
  'description': 'i7ZUWAqwLu9b4E8oXZq4uX6X5W6BJnkuHz',
  'price': 'iLjLxTk1bkEd7SAAWT27VQ7ECFuLtTnuKv',
  'currency': 'iANfkUFM797eunQt4nFV3j7SvK8pUkfsJe',
  'category': 'iGiUqVQcdLC3UAj8mHtSyWNsAKdEVXUFVC',
  'turnaround': 'iNGq3xh28oV2U3VmMtQ3gjMX8jrH1ohKfp',
  'status': 'iNbPugdyVSCv54zsZs68vAfvifcf14btX2',
};

let REVIEW_KEYS: Record<string, string> = {
  'buyer': 'iPbx6NP7ZVLySKJU5Rfbt3saxNLaxHHV85',
  'jobHash': 'iFgEMF3Fbj1EFU7bAPjmrvMKUU9QfZumNP',
  'message': 'iKokqh2YmULa4HkSWRRJaywNMvGzRv7JTt',
  'rating': 'iDznRwvMsTaMmQ6zkfQTJKWb5YCh8RHyp5',
  'signature': 'iJZHVjWN22cLXx3MPWjpq7VeSBndjFtZB5',
  'timestamp': 'iL13pKpKAQZ4hm2vECGQ5EmFBqRzEneJrq',
};

let PLATFORM_KEYS: Record<string, string> = {
  'datapolicy': 'i6y4XPg5m9YeeP1Rk2iqJGiZwtWWK8pBoC',
  'trustlevel': 'iDDiY2y6Juo9vUprbB69utX55pzcpkNKoW',
  'disputeresolution': 'iJjCHbDoE6r4PqWe2i7SXGuPCn4Fw48Krw',
};

let SESSION_KEYS: Record<string, string> = {
  'duration': 'iEfV7FSNNorTcoukVXpUadneaCB44GJXRt',
  'tokenLimit': 'iK7AVbtFj9hKxy7XaCyzc4iPo8jfpeENQG',
  'imageLimit': 'i733ccahSD96tjGLvypVFozZ5i15xPSzZu',
  'messageLimit': 'iLrDehY12RhJJ5XGi49QTfZsasY1L7RKWz',
  'maxFileSize': 'i6iGYRcbtaPHyagDsv77Sja66HNFcA73Fw',
  'allowedFileTypes': 'i4WmLAEe78myVEPKdWSfRBTEb5sRoWhwjR',
};

// --- Derived lookups (rebuilt after schema load) ---

let AGENT_I_ADDRESS_TO_FIELD: Record<string, string> = {};
let SERVICE_I_ADDRESS_TO_FIELD: Record<string, string> = {};
let REVIEW_I_ADDRESS_TO_FIELD: Record<string, string> = {};
let PLATFORM_I_ADDRESS_TO_FIELD: Record<string, string> = {};
let SESSION_I_ADDRESS_TO_FIELD: Record<string, string> = {};

let AGENT_VDXF_ADDRESSES_SET: Set<string> = new Set();
let SERVICE_VDXF_ADDRESSES_SET: Set<string> = new Set();
let REVIEW_VDXF_ADDRESSES_SET: Set<string> = new Set();
let PLATFORM_VDXF_ADDRESSES_SET: Set<string> = new Set();
let SESSION_VDXF_ADDRESSES_SET: Set<string> = new Set();

function rebuildLookups(): void {
  AGENT_I_ADDRESS_TO_FIELD = Object.fromEntries(Object.entries(AGENT_KEYS).map(([k, v]) => [v, k]));
  SERVICE_I_ADDRESS_TO_FIELD = Object.fromEntries(Object.entries(SERVICE_KEYS).map(([k, v]) => [v, k]));
  REVIEW_I_ADDRESS_TO_FIELD = Object.fromEntries(Object.entries(REVIEW_KEYS).map(([k, v]) => [v, k]));
  PLATFORM_I_ADDRESS_TO_FIELD = Object.fromEntries(Object.entries(PLATFORM_KEYS).map(([k, v]) => [v, k]));
  SESSION_I_ADDRESS_TO_FIELD = Object.fromEntries(Object.entries(SESSION_KEYS).map(([k, v]) => [v, k]));

  AGENT_VDXF_ADDRESSES_SET = new Set(Object.values(AGENT_KEYS));
  SERVICE_VDXF_ADDRESSES_SET = new Set(Object.values(SERVICE_KEYS));
  REVIEW_VDXF_ADDRESSES_SET = new Set(Object.values(REVIEW_KEYS));
  PLATFORM_VDXF_ADDRESSES_SET = new Set(Object.values(PLATFORM_KEYS));
  SESSION_VDXF_ADDRESSES_SET = new Set(Object.values(SESSION_KEYS));
}

// Initialize with defaults
rebuildLookups();

// --- Schema prefix patterns for categorizing keys ---
const SCHEMA_PREFIXES: Record<string, { target: Record<string, string>; prefix: string }> = {
  'agent': { target: AGENT_KEYS, prefix: '::agent.v1.' },
  'service': { target: SERVICE_KEYS, prefix: '::svc.v1.' },
  'review': { target: REVIEW_KEYS, prefix: '::review.v1.' },
  'platform': { target: PLATFORM_KEYS, prefix: '::platform.v1.' },
  'session': { target: SESSION_KEYS, prefix: '::session.v1.' },
};

/**
 * Load VDXF schema keys from the agentplatform@ identity on-chain.
 * Call this at startup before the indexer begins processing blocks.
 * Falls back to hardcoded defaults if the chain is unreachable.
 */
export async function loadSchemaFromChain(rpcCall: (method: string, params: unknown[]) => Promise<unknown>): Promise<void> {
  const platformId = process.env.PLATFORM_SIGNING_ID || 'agentplatform@';
  try {
    const result = await rpcCall('getidentity', [platformId]) as {
      identity: { contentmultimap?: Record<string, string[]> };
    };

    const cmm = result?.identity?.contentmultimap;
    if (!cmm || Object.keys(cmm).length === 0) {
      console.log('[VDXF] No schema found on-chain, using hardcoded defaults');
      return;
    }

    // Reset key maps before populating from chain
    const newAgent: Record<string, string> = {};
    const newService: Record<string, string> = {};
    const newReview: Record<string, string> = {};
    const newPlatform: Record<string, string> = {};
    const newSession: Record<string, string> = {};

    let loadedCount = 0;

    for (const [iAddress, values] of Object.entries(cmm)) {
      if (!values || values.length === 0) continue;

      // Decode the hex value to get the key name string
      let keyName: string;
      try {
        keyName = Buffer.from(values[0], 'hex').toString('utf-8');
      } catch {
        continue;
      }

      // Categorize by prefix pattern (e.g. "agentplatform::agent.v1.name" -> agent/name)
      let matched = false;
      for (const { target, prefix } of Object.values(SCHEMA_PREFIXES)) {
        const prefixIdx = keyName.indexOf(prefix);
        if (prefixIdx >= 0) {
          const fieldName = keyName.substring(prefixIdx + prefix.length);
          if (fieldName) {
            // Route to the correct target map
            if (prefix === '::agent.v1.') newAgent[fieldName] = iAddress;
            else if (prefix === '::svc.v1.') newService[fieldName] = iAddress;
            else if (prefix === '::review.v1.') newReview[fieldName] = iAddress;
            else if (prefix === '::platform.v1.') newPlatform[fieldName] = iAddress;
            else if (prefix === '::session.v1.') newSession[fieldName] = iAddress;
            loadedCount++;
            matched = true;
            break;
          }
        }
      }

      if (!matched) {
        console.log(`[VDXF] Unknown schema key: ${keyName} (${iAddress})`);
      }
    }

    if (loadedCount === 0) {
      console.log('[VDXF] No valid schema keys parsed from chain, using hardcoded defaults');
      return;
    }

    // Apply loaded keys (only replace categories that had keys on chain)
    if (Object.keys(newAgent).length > 0) AGENT_KEYS = newAgent;
    if (Object.keys(newService).length > 0) SERVICE_KEYS = newService;
    if (Object.keys(newReview).length > 0) REVIEW_KEYS = newReview;
    if (Object.keys(newPlatform).length > 0) PLATFORM_KEYS = newPlatform;
    if (Object.keys(newSession).length > 0) SESSION_KEYS = newSession;

    // Update SCHEMA_PREFIXES targets (they hold references to old objects)
    SCHEMA_PREFIXES['agent'].target = AGENT_KEYS;
    SCHEMA_PREFIXES['service'].target = SERVICE_KEYS;
    SCHEMA_PREFIXES['review'].target = REVIEW_KEYS;
    SCHEMA_PREFIXES['platform'].target = PLATFORM_KEYS;
    SCHEMA_PREFIXES['session'].target = SESSION_KEYS;

    rebuildLookups();

    console.log(`[VDXF] Loaded ${loadedCount} schema keys from ${platformId} on-chain`);
    console.log(`[VDXF]   agent: ${Object.keys(AGENT_KEYS).length}, service: ${Object.keys(SERVICE_KEYS).length}, review: ${Object.keys(REVIEW_KEYS).length}, platform: ${Object.keys(PLATFORM_KEYS).length}, session: ${Object.keys(SESSION_KEYS).length}`);
  } catch (err) {
    console.warn(`[VDXF] Failed to load schema from chain, using hardcoded defaults:`, err instanceof Error ? err.message : err);
  }
}

// --- Public API (same interface as before) ---

// Sets are used internally by the isXxxVdxfKey() functions above.
// They are rebuilt by rebuildLookups() after schema load.

export const VDXF_KEYS = {
  get agent() { return AGENT_KEYS; },
  get service() { return SERVICE_KEYS; },
  get review() { return REVIEW_KEYS; },
  get platform() { return PLATFORM_KEYS; },
  get session() { return SESSION_KEYS; },
};

export function isAgentVdxfKey(iAddress: string): boolean {
  return AGENT_VDXF_ADDRESSES_SET.has(iAddress);
}

export function isServiceVdxfKey(iAddress: string): boolean {
  return SERVICE_VDXF_ADDRESSES_SET.has(iAddress);
}

export function isReviewVdxfKey(iAddress: string): boolean {
  return REVIEW_VDXF_ADDRESSES_SET.has(iAddress);
}

export function isPlatformVdxfKey(iAddress: string): boolean {
  return PLATFORM_VDXF_ADDRESSES_SET.has(iAddress);
}

export function isSessionVdxfKey(iAddress: string): boolean {
  return SESSION_VDXF_ADDRESSES_SET.has(iAddress);
}

export function getFieldName(iAddress: string): string | undefined {
  return AGENT_I_ADDRESS_TO_FIELD[iAddress];
}

export function getFieldNameByType(iAddress: string, type: 'agent' | 'service' | 'review' | 'platform' | 'session'): string | undefined {
  switch (type) {
    case 'agent': return AGENT_I_ADDRESS_TO_FIELD[iAddress];
    case 'service': return SERVICE_I_ADDRESS_TO_FIELD[iAddress];
    case 'review': return REVIEW_I_ADDRESS_TO_FIELD[iAddress];
    case 'platform': return PLATFORM_I_ADDRESS_TO_FIELD[iAddress];
    case 'session': return SESSION_I_ADDRESS_TO_FIELD[iAddress];
  }
}

export function hasAgentData(contentmap: Record<string, unknown> | undefined, contentmultimap: Record<string, unknown[]> | undefined): boolean {
  return hasDataOfType(contentmap, contentmultimap, isAgentVdxfKey);
}

export function hasServiceData(contentmap: Record<string, unknown> | undefined, contentmultimap: Record<string, unknown[]> | undefined): boolean {
  if (hasDataOfType(contentmap, contentmultimap, isServiceVdxfKey)) return true;
  const servicesKey = AGENT_KEYS['services'];
  if (contentmultimap && contentmultimap[servicesKey]) return true;
  if (contentmap && contentmap[servicesKey]) return true;
  return false;
}

export function hasReviewData(contentmap: Record<string, unknown> | undefined, contentmultimap: Record<string, unknown[]> | undefined): boolean {
  return hasDataOfType(contentmap, contentmultimap, isReviewVdxfKey);
}

export function hasSessionData(contentmap: Record<string, unknown> | undefined, contentmultimap: Record<string, unknown[]> | undefined): boolean {
  return hasDataOfType(contentmap, contentmultimap, isSessionVdxfKey);
}

function hasDataOfType(
  contentmap: Record<string, unknown> | undefined,
  contentmultimap: Record<string, unknown[]> | undefined,
  checker: (key: string) => boolean
): boolean {
  if (contentmap) {
    for (const key of Object.keys(contentmap)) {
      if (checker(key)) return true;
    }
  }
  if (contentmultimap) {
    for (const key of Object.keys(contentmultimap)) {
      if (checker(key)) return true;
    }
  }
  return false;
}

export function extractAgentData(
  contentmap: Record<string, string> | undefined,
  contentmultimap: Record<string, string[]> | undefined
): Record<string, unknown> {
  return extractDataOfType(contentmap, contentmultimap, 'agent');
}

export function extractServiceData(
  contentmap: Record<string, string> | undefined,
  contentmultimap: Record<string, string[]> | undefined
): Record<string, unknown> {
  const data = extractDataOfType(contentmap, contentmultimap, 'service');
  if (Object.keys(data).length > 0) return data;
  const services = extractServicesArray(contentmap, contentmultimap);
  return services.length > 0 ? services[0] : {};
}

export function extractServicesArray(
  contentmap: Record<string, string> | undefined,
  contentmultimap: Record<string, string[]> | undefined
): Array<Record<string, unknown>> {
  const servicesKey = AGENT_KEYS['services'];
  const services: Array<Record<string, unknown>> = [];

  // Check contentmultimap (array of hex-encoded JSON objects or JSON arrays)
  if (contentmultimap && contentmultimap[servicesKey]) {
    for (const hexValue of contentmultimap[servicesKey]) {
      try {
        const parsed = parseVdxfValue(hexValue);
        if (Array.isArray(parsed)) {
          for (const item of (parsed as Array<Record<string, unknown>>).slice(0, 100)) {
            if (item && typeof item === 'object') services.push(item);
          }
        } else if (parsed && typeof parsed === 'object') {
          services.push(parsed as Record<string, unknown>);
        }
      } catch {
        // Skip invalid values
      }
    }
  }

  // Check contentmap
  if (contentmap && contentmap[servicesKey]) {
    try {
      const parsed = parseVdxfValue(contentmap[servicesKey]);
      if (Array.isArray(parsed)) {
        for (const item of (parsed as Array<Record<string, unknown>>).slice(0, 100)) {
          services.push(item);
        }
      } else if (parsed && typeof parsed === 'object') {
        services.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Skip invalid values
    }
  }

  return services.slice(0, 100);
}

export function extractReviews(
  contentmultimap: Record<string, string[]> | undefined
): Array<Record<string, unknown>> {
  if (!contentmultimap) return [];

  const buyerKey = REVIEW_KEYS['buyer'];
  const reviews: Array<Record<string, unknown>> = [];

  if (!contentmultimap[buyerKey]) return [];

  const reviewCount = Math.min(contentmultimap[buyerKey]?.length || 0, 100);

  for (let i = 0; i < reviewCount; i++) {
    const review: Record<string, unknown> = {};
    for (const [field, iAddress] of Object.entries(REVIEW_KEYS)) {
      const values = contentmultimap[iAddress];
      if (values && values[i]) {
        review[field] = parseVdxfValue(values[i]);
      }
    }
    if (Object.keys(review).length > 0) {
      reviews.push(review);
    }
  }

  return reviews;
}

export function extractSessionData(
  contentmap: Record<string, string> | undefined,
  contentmultimap: Record<string, string[]> | undefined
): Record<string, unknown> {
  return extractDataOfType(contentmap, contentmultimap, 'session');
}

function extractDataOfType(
  contentmap: Record<string, string> | undefined,
  contentmultimap: Record<string, string[]> | undefined,
  type: 'agent' | 'service' | 'review' | 'platform' | 'session'
): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  if (contentmap) {
    for (const [iAddress, value] of Object.entries(contentmap)) {
      const fieldName = getFieldNameByType(iAddress, type);
      if (fieldName) {
        data[fieldName] = parseVdxfValue(value);
      }
    }
  }

  // Fields that should collect all multimap values into an array
  const ARRAY_FIELDS = new Set(['capabilities', 'endpoints', 'protocols']);

  if (contentmultimap) {
    for (const [iAddress, values] of Object.entries(contentmultimap)) {
      const fieldName = getFieldNameByType(iAddress, type);
      if (fieldName && values.length > 0) {
        if (ARRAY_FIELDS.has(fieldName)) {
          data[fieldName] = values.map(v => parseVdxfValue(v));
        } else {
          data[fieldName] = parseVdxfValue(values[0]);
        }
      }
    }
  }

  return data;
}

export function parseVdxfValue(hexValue: string): unknown {
  try {
    if (hexValue.length > 20480) {
      return hexValue.substring(0, 100) + '...[truncated]';
    }
    const decoded = Buffer.from(hexValue, 'hex').toString('utf-8');
    try {
      return JSON.parse(decoded);
    } catch {
      return decoded;
    }
  } catch {
    return hexValue;
  }
}

export function encodeVdxfValue(value: unknown): string {
  const json = JSON.stringify(value);
  return Buffer.from(json).toString('hex');
}
