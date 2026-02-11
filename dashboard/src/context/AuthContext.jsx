import { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

// In dev, use empty string to go through Vite proxy (avoids CORS)
// In prod, set VITE_API_URL to the actual API domain
const API_BASE = import.meta.env.VITE_API_URL || '';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);

  // requireAuth: call this to trigger the login modal. Returns void.
  // Components can use: const { requireAuth } = useAuth(); then requireAuth();
  function requireAuth() {
    if (!user) setShowAuthModal(true);
  }

  // Check session on mount
  useEffect(() => {
    checkSession();
  }, []);

  async function checkSession() {
    try {
      const res = await fetch(`${API_BASE}/auth/session`, {
        credentials: 'include',
      });
      const data = await res.json();
      
      if (data.data?.authenticated) {
        setUser({ 
          verusId: data.data.verusId,
          identityName: data.data.identityName 
        });
      } else {
        setUser(null);
      }
    } catch (err) {
      console.error('Session check failed:', err);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  async function getChallenge() {
    const res = await fetch(`${API_BASE}/auth/challenge`, {
      credentials: 'include',
    });
    
    if (!res.ok) {
      const text = await res.text();
      try {
        const data = JSON.parse(text);
        throw new Error(data.error?.message || 'Failed to get challenge');
      } catch {
        throw new Error(`Server error: ${res.status}`);
      }
    }
    
    const data = await res.json();
    
    if (!data.data) {
      throw new Error(data.error?.message || 'Failed to get challenge');
    }
    
    return data.data;
  }

  async function login(challengeId, verusId, signature) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ challengeId, verusId, signature }),
    });
    
    const text = await res.text();
    if (!text) {
      throw new Error('Empty response from server');
    }
    
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Invalid response: ${text.slice(0, 100)}`);
    }
    
    if (!res.ok) {
      throw new Error(data.error?.message || 'Login failed');
    }
    
    setUser({ 
      verusId: data.data.identityAddress,  // Use resolved i-address, not input
      identityName: data.data.identityName 
    });
    return data.data;
  }

  async function logout() {
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch (err) {
      console.error('Logout failed:', err);
    }
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, getChallenge, login, logout, requireAuth, showAuthModal, setShowAuthModal }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
