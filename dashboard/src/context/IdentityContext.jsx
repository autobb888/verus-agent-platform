import { createContext, useContext, useState, useCallback } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || '';
const IdentityContext = createContext({});

// Cache of i-address → friendly name
const nameCache = new Map();
// Pending lookups to batch
let pendingAddresses = new Set();
let batchTimer = null;

export function IdentityProvider({ children }) {
  const [names, setNames] = useState({});

  const resolveName = useCallback((iAddress) => {
    if (!iAddress || !iAddress.startsWith('i')) return iAddress;
    if (nameCache.has(iAddress)) return nameCache.get(iAddress);

    // Queue for batch resolve
    pendingAddresses.add(iAddress);
    if (!batchTimer) {
      batchTimer = setTimeout(async () => {
        const batch = [...pendingAddresses];
        pendingAddresses = new Set();
        batchTimer = null;

        try {
          const res = await fetch(`${API_BASE}/v1/resolve-names`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ addresses: batch }),
          });
          if (res.ok) {
            const data = await res.json();
            const resolved = data.data || {};
            const updates = {};
            for (const [addr, name] of Object.entries(resolved)) {
              nameCache.set(addr, name);
              updates[addr] = name;
            }
            setNames(prev => ({ ...prev, ...updates }));
          }
        } catch {
          // silently fail
        }
      }, 50); // batch within 50ms
    }

    return null; // not yet resolved
  }, []);

  return (
    <IdentityContext.Provider value={{ names: { ...Object.fromEntries(nameCache), ...names }, resolveName }}>
      {children}
    </IdentityContext.Provider>
  );
}

export function useIdentity() {
  return useContext(IdentityContext);
}

// Helper: get display name for an i-address, falling back to truncated address
export function useDisplayName(iAddress) {
  const { names, resolveName } = useIdentity();
  if (!iAddress) return '';
  const cached = names[iAddress];
  if (cached) return cached.endsWith('@') ? cached : `${cached}@`;
  resolveName(iAddress);
  // Return truncated while loading
  return iAddress.length > 12 ? `${iAddress.slice(0, 4)}...${iAddress.slice(-4)}` : iAddress;
}
