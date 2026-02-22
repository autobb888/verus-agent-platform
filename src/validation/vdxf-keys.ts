// AgentPlatform Schema Keys (VerusID-based, VRSCTEST)
// Each key is a DefinedKey registered under agentplatform@
// Their i-addresses are used as contentmultimap keys on-chain

// Agent schema keys (agentplatform::agent.v1.{field})
const AGENT_KEYS: Record<string, string> = {
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
};

// Service schema keys (agentplatform::svc.v1.{field})
const SERVICE_KEYS: Record<string, string> = {
  'name': 'iNTrSV1bqDAoaGRcpR51BeoS5wQvQ4P9Qj',
  'description': 'i7ZUWAqwLu9b4E8oXZq4uX6X5W6BJnkuHz',
  'price': 'iLjLxTk1bkEd7SAAWT27VQ7ECFuLtTnuKv',
  'currency': 'iANfkUFM797eunQt4nFV3j7SvK8pUkfsJe',
  'category': 'iGiUqVQcdLC3UAj8mHtSyWNsAKdEVXUFVC',
  'turnaround': 'iNGq3xh28oV2U3VmMtQ3gjMX8jrH1ohKfp',
  'status': 'iNbPugdyVSCv54zsZs68vAfvifcf14btX2',
};

// Review schema keys (agentplatform::review.v1.{field})
const REVIEW_KEYS: Record<string, string> = {
  'buyer': 'iPbx6NP7ZVLySKJU5Rfbt3saxNLaxHHV85',
  'jobHash': 'iFgEMF3Fbj1EFU7bAPjmrvMKUU9QfZumNP',
  'message': 'iKokqh2YmULa4HkSWRRJaywNMvGzRv7JTt',
  'rating': 'iDznRwvMsTaMmQ6zkfQTJKWb5YCh8RHyp5',
  'signature': 'iJZHVjWN22cLXx3MPWjpq7VeSBndjFtZB5',
  'timestamp': 'iL13pKpKAQZ4hm2vECGQ5EmFBqRzEneJrq',
};

// Platform-level keys (agentplatform::platform.v1.{field})
const PLATFORM_KEYS: Record<string, string> = {
  'datapolicy': 'i6y4XPg5m9YeeP1Rk2iqJGiZwtWWK8pBoC',
  'trustlevel': 'iDDiY2y6Juo9vUprbB69utX55pzcpkNKoW',
  'disputeresolution': 'iJjCHbDoE6r4PqWe2i7SXGuPCn4Fw48Krw',
};

// Session parameter keys (agentplatform::session.v1.{field})
const SESSION_KEYS: Record<string, string> = {
  'duration':        'iEfV7FSNNorTcoukVXpUadneaCB44GJXRt',  // seconds (e.g. 900, 3600)
  'tokenLimit':      'iK7AVbtFj9hKxy7XaCyzc4iPo8jfpeENQG',  // max LLM tokens per session
  'imageLimit':      'i733ccahSD96tjGLvypVFozZ5i15xPSzZu',  // max images per session
  'messageLimit':    'iLrDehY12RhJJ5XGi49QTfZsasY1L7RKWz',  // max messages per session
  'maxFileSize':     'i6iGYRcbtaPHyagDsv77Sja66HNFcA73Fw',  // max file size in bytes
  'allowedFileTypes':'i4WmLAEe78myVEPKdWSfRBTEb5sRoWhwjR',  // comma-separated MIME types
};

// Backward compatibility aliases
const ARI_AGENT_KEYS = AGENT_KEYS;
const ARI_SERVICE_KEYS = SERVICE_KEYS;
const ARI_REVIEW_KEYS = REVIEW_KEYS;
const ARI_NAMESPACE_KEYS = AGENT_KEYS;

// Reverse lookups: i-address to field name
const AGENT_I_ADDRESS_TO_FIELD: Record<string, string> = Object.fromEntries(
  Object.entries(AGENT_KEYS).map(([k, v]) => [v, k])
);
const SERVICE_I_ADDRESS_TO_FIELD: Record<string, string> = Object.fromEntries(
  Object.entries(SERVICE_KEYS).map(([k, v]) => [v, k])
);
const REVIEW_I_ADDRESS_TO_FIELD: Record<string, string> = Object.fromEntries(
  Object.entries(REVIEW_KEYS).map(([k, v]) => [v, k])
);
const PLATFORM_I_ADDRESS_TO_FIELD: Record<string, string> = Object.fromEntries(
  Object.entries(PLATFORM_KEYS).map(([k, v]) => [v, k])
);
const SESSION_I_ADDRESS_TO_FIELD: Record<string, string> = Object.fromEntries(
  Object.entries(SESSION_KEYS).map(([k, v]) => [v, k])
);

// Backward compat
const I_ADDRESS_TO_FIELD = AGENT_I_ADDRESS_TO_FIELD;

// All known VDXF i-addresses by type
export const AGENT_VDXF_ADDRESSES = new Set(Object.values(AGENT_KEYS));
export const SERVICE_VDXF_ADDRESSES = new Set(Object.values(SERVICE_KEYS));
export const REVIEW_VDXF_ADDRESSES = new Set(Object.values(REVIEW_KEYS));
export const PLATFORM_VDXF_ADDRESSES = new Set(Object.values(PLATFORM_KEYS));
export const SESSION_VDXF_ADDRESSES = new Set(Object.values(SESSION_KEYS));

// Export key maps for indexer use
export const VDXF_KEYS = {
  agent: AGENT_KEYS,
  service: SERVICE_KEYS,
  review: REVIEW_KEYS,
  platform: PLATFORM_KEYS,
  session: SESSION_KEYS,
};

/**
 * Check if an i-address is a known agent VDXF key
 */
export function isAgentVdxfKey(iAddress: string): boolean {
  return AGENT_VDXF_ADDRESSES.has(iAddress);
}

/**
 * Check if an i-address is a known service VDXF key
 */
export function isServiceVdxfKey(iAddress: string): boolean {
  return SERVICE_VDXF_ADDRESSES.has(iAddress);
}

/**
 * Check if an i-address is a known review VDXF key
 */
export function isReviewVdxfKey(iAddress: string): boolean {
  return REVIEW_VDXF_ADDRESSES.has(iAddress);
}

/**
 * Check if an i-address is a known platform VDXF key
 */
export function isPlatformVdxfKey(iAddress: string): boolean {
  return PLATFORM_VDXF_ADDRESSES.has(iAddress);
}

/**
 * Check if an i-address is a known session VDXF key
 */
export function isSessionVdxfKey(iAddress: string): boolean {
  return SESSION_VDXF_ADDRESSES.has(iAddress);
}

/**
 * Get the field name for a VDXF i-address
 */
export function getFieldName(iAddress: string): string | undefined {
  return I_ADDRESS_TO_FIELD[iAddress];
}

/**
 * Get field name for any VDXF schema type
 */
export function getFieldNameByType(iAddress: string, type: 'agent' | 'service' | 'review' | 'platform' | 'session'): string | undefined {
  switch (type) {
    case 'agent': return AGENT_I_ADDRESS_TO_FIELD[iAddress];
    case 'service': return SERVICE_I_ADDRESS_TO_FIELD[iAddress];
    case 'review': return REVIEW_I_ADDRESS_TO_FIELD[iAddress];
    case 'platform': return PLATFORM_I_ADDRESS_TO_FIELD[iAddress];
    case 'session': return SESSION_I_ADDRESS_TO_FIELD[iAddress];
  }
}

/**
 * Check if an identity's contentmap/contentmultimap has any agent VDXF keys
 */
export function hasAgentData(contentmap: Record<string, unknown> | undefined, contentmultimap: Record<string, unknown[]> | undefined): boolean {
  return hasDataOfType(contentmap, contentmultimap, isAgentVdxfKey);
}

/**
 * Check if an identity has service data
 * Supports both individual service keys AND services stored as JSON array under services key
 */
export function hasServiceData(contentmap: Record<string, unknown> | undefined, contentmultimap: Record<string, unknown[]> | undefined): boolean {
  // Check for individual service keys
  if (hasDataOfType(contentmap, contentmultimap, isServiceVdxfKey)) return true;
  
  // Check for services stored as JSON array under services key
  const servicesKey = AGENT_KEYS['services'];
  if (contentmultimap && contentmultimap[servicesKey]) return true;
  if (contentmap && contentmap[servicesKey]) return true;
  
  return false;
}

/**
 * Check if an identity has review data
 */
export function hasReviewData(contentmap: Record<string, unknown> | undefined, contentmultimap: Record<string, unknown[]> | undefined): boolean {
  return hasDataOfType(contentmap, contentmultimap, isReviewVdxfKey);
}

/**
 * Check if an identity has session parameter data
 */
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

/**
 * Extract agent data from identity contentmap/contentmultimap
 */
export function extractAgentData(
  contentmap: Record<string, string> | undefined,
  contentmultimap: Record<string, string[]> | undefined
): Record<string, unknown> {
  return extractDataOfType(contentmap, contentmultimap, 'agent');
}

/**
 * Extract service data from identity contentmap/contentmultimap
 * Returns first service found (for backward compatibility)
 */
export function extractServiceData(
  contentmap: Record<string, string> | undefined,
  contentmultimap: Record<string, string[]> | undefined
): Record<string, unknown> {
  // First try extracting from individual service keys
  const data = extractDataOfType(contentmap, contentmultimap, 'service');
  if (Object.keys(data).length > 0) return data;
  
  // Otherwise extract from JSON array format
  const services = extractServicesArray(contentmap, contentmultimap);
  return services.length > 0 ? services[0] : {};
}

/**
 * Extract all services from identity contentmap/contentmultimap
 * Handles services stored as JSON array under services key
 */
export function extractServicesArray(
  contentmap: Record<string, string> | undefined,
  contentmultimap: Record<string, string[]> | undefined
): Array<Record<string, unknown>> {
  const servicesKey = AGENT_KEYS['services'];
  const services: Array<Record<string, unknown>> = [];
  
  // Check contentmultimap (array of hex-encoded JSON objects)
  if (contentmultimap && contentmultimap[servicesKey]) {
    for (const hexValue of contentmultimap[servicesKey]) {
      try {
        const parsed = parseVdxfValue(hexValue);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          services.push(parsed as Record<string, unknown>);
        }
      } catch {
        // Skip invalid values
      }
    }
  }
  
  // Check contentmap (single hex value - shouldn't happen but handle it)
  if (contentmap && contentmap[servicesKey]) {
    try {
      const parsed = parseVdxfValue(contentmap[servicesKey]);
      if (Array.isArray(parsed)) {
        services.push(...(parsed as Array<Record<string, unknown>>));
      } else if (parsed && typeof parsed === 'object') {
        services.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Skip invalid values
    }
  }
  
  return services;
}

/**
 * Extract all reviews from identity contentmultimap
 */
export function extractReviews(
  contentmultimap: Record<string, string[]> | undefined
): Array<Record<string, unknown>> {
  if (!contentmultimap) return [];
  
  const buyerKey = REVIEW_KEYS['buyer'];
  const reviews: Array<Record<string, unknown>> = [];
  
  if (!contentmultimap[buyerKey]) return [];
  
  const reviewCount = contentmultimap[buyerKey]?.length || 0;
  
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

/**
 * Extract session parameter data from identity contentmap/contentmultimap
 */
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

  if (contentmultimap) {
    for (const [iAddress, values] of Object.entries(contentmultimap)) {
      const fieldName = getFieldNameByType(iAddress, type);
      if (fieldName && values.length > 0) {
        data[fieldName] = parseVdxfValue(values[0]);
      }
    }
  }

  return data;
}

/**
 * Parse a VDXF value (hex-encoded JSON or string)
 */
export function parseVdxfValue(hexValue: string): unknown {
  try {
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

/**
 * Encode a value to VDXF hex format
 */
export function encodeVdxfValue(value: unknown): string {
  const json = JSON.stringify(value);
  return Buffer.from(json).toString('hex');
}
