import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import CopyButton from './CopyButton';

const API_BASE = import.meta.env.VITE_API_URL || '';

/**
 * AuthModal — On-demand VerusID login modal.
 * Replaces the dedicated LoginPage. Shows when an unauthenticated user
 * tries to do something that requires auth.
 */
export default function AuthModal({ isOpen, onClose, onSuccess }) {
  const { getChallenge, login } = useAuth();
  const [mode, setMode] = useState('choose');
  const [step, setStep] = useState('start');
  const [challenge, setChallenge] = useState(null);
  const [qrChallenge, setQrChallenge] = useState(null);
  const [verusId, setVerusId] = useState('');
  const [signature, setSignature] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const pollIntervalRef = useRef(null);

  // Cleanup polling on unmount or close
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  // On mobile, re-poll immediately when user returns from Verus Mobile (tab was suspended).
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'visible' && qrChallenge?.challengeId && mode === 'qr') {
        (async () => {
          try {
            const res = await fetch(`${API_BASE}/auth/qr/status/${qrChallenge.challengeId}`, { credentials: 'include' });
            const data = await res.json();
            if (data.data?.status === 'completed') {
              if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
              window.location.reload();
            } else if (data.data?.status === 'expired') {
              if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
              setError('QR code expired. Please try again.');
              setMode('choose');
            }
          } catch {}
        })();
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [qrChallenge, mode]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setMode('choose');
      setStep('start');
      setChallenge(null);
      setQrChallenge(null);
      setVerusId('');
      setSignature('');
      setError('');
      setLoading(false);
    } else {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  async function startQRLogin() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/auth/qr/challenge`, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Failed to get QR challenge');

      setQrChallenge(data.data);
      setMode('qr');

      pollIntervalRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(`${API_BASE}/auth/qr/status/${data.data.challengeId}`, { credentials: 'include' });
          const statusData = await statusRes.json();
          if (statusData.data?.status === 'completed') {
            clearInterval(pollIntervalRef.current);
            window.location.reload();
          } else if (statusData.data?.status === 'expired') {
            clearInterval(pollIntervalRef.current);
            setError('QR code expired. Please try again.');
            setMode('choose');
          }
        } catch (err) {
          console.error('Poll error:', err);
        }
      }, 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleGetChallenge() {
    setLoading(true);
    setError('');
    try {
      const data = await getChallenge();
      setChallenge(data);
      setStep('challenge');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login(challenge.challengeId, verusId, signature);
      onSuccess?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function resetToChoose() {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    setMode('choose');
    setStep('start');
    setQrChallenge(null);
    setChallenge(null);
    setError('');
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-md mx-4 bg-gray-800 rounded-xl shadow-2xl border border-gray-700 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚡</span>
            <div>
              <h2 className="text-lg font-bold text-white">Sign In</h2>
              <p className="text-xs text-gray-400">Authenticate with your VerusID</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl transition-colors">✕</button>
        </div>

        <div className="p-6">
          {/* Choose method */}
          {mode === 'choose' && (
            <div className="space-y-3">
              <button
                onClick={startQRLogin}
                disabled={loading}
                className="w-full py-4 px-4 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-3"
              >
                <span className="text-2xl">📱</span>
                <div className="text-left">
                  <div className="font-semibold">Verus Mobile</div>
                  <div className="text-sm text-gray-400">Scan QR code</div>
                </div>
              </button>
              <button
                onClick={() => { setMode('manual'); handleGetChallenge(); }}
                disabled={loading}
                className="w-full py-4 px-4 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-3"
              >
                <span className="text-2xl">💻</span>
                <div className="text-left">
                  <div className="font-semibold">CLI / Desktop Wallet</div>
                  <div className="text-sm text-gray-400">Sign a challenge message</div>
                </div>
              </button>
            </div>
          )}

          {/* QR Login */}
          {mode === 'qr' && qrChallenge && (
            <div className="text-center">
              <div className="hidden md:block">
                <p className="text-gray-300 mb-4">Scan with Verus Mobile:</p>
                <div className="bg-white p-4 rounded-lg inline-block mb-4">
                  <img src={qrChallenge.qrDataUrl} alt="Login QR" className="w-56 h-56" />
                </div>
              </div>
              <div className="md:hidden">
                <p className="text-gray-300 mb-4">Tap to open Verus Mobile:</p>
                <a
                  href={/^verus(id)?:\/\//i.test(qrChallenge.deeplink) ? qrChallenge.deeplink : '#'}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg transition-colors mb-4"
                >
                  📱 Open Verus Mobile
                </a>
              </div>
              <p className="text-xs text-gray-500 mb-3">
                Expires: {new Date(qrChallenge.expiresAt).toLocaleTimeString()}
              </p>
              <div className="animate-pulse text-gray-400 text-sm mb-4">Waiting for signature...</div>
              <button onClick={resetToChoose} className="text-sm text-gray-400 hover:text-white transition-colors">
                ← Back
              </button>
            </div>
          )}

          {/* Manual CLI Login */}
          {mode === 'manual' && step === 'challenge' && challenge && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Sign this message:</label>
                <pre className="bg-gray-900 rounded-lg p-3 text-xs text-gray-300 overflow-x-auto whitespace-pre-wrap break-all border border-gray-700 max-h-24 overflow-y-auto">
                  {challenge.challenge}
                </pre>
                <div className="mt-2 relative">
                  <pre className="bg-gray-900 rounded-lg p-2 text-xs text-green-400 overflow-x-auto whitespace-pre-wrap break-all border border-gray-700">
{`signmessage "${verusId || 'yourID@'}" "${challenge.challenge}"`}
                  </pre>
                  <CopyButton text={`signmessage "${verusId || 'yourID@'}" "${challenge.challenge}"`} className="absolute top-1 right-1" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">VerusID <span className="text-gray-500 font-normal">(with @ symbol)</span></label>
                <input
                  type="text"
                  value={verusId}
                  onChange={(e) => setVerusId(e.target.value)}
                  placeholder="yourname.agentplatform@"
                  className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-verus-blue"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Signature</label>
                <textarea
                  value={signature}
                  onChange={(e) => setSignature(e.target.value)}
                  placeholder="Paste signature here..."
                  rows={2}
                  className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-verus-blue font-mono text-sm"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading || !verusId || !signature}
                className="w-full py-3 bg-verus-blue hover:bg-blue-600 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {loading ? 'Verifying...' : 'Sign In'}
              </button>
              <button type="button" onClick={resetToChoose} className="w-full py-2 text-sm text-gray-400 hover:text-white transition-colors">
                ← Back
              </button>
            </form>
          )}

          {/* Loading state for challenge fetch */}
          {mode === 'manual' && step === 'start' && (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-verus-blue"></div>
            </div>
          )}

          {error && (
            <div className="mt-4 p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-700 text-center">
          <p className="text-gray-500 text-xs">
            No VerusID? <a href="https://verus.io/wallet" target="_blank" rel="noopener noreferrer" className="text-verus-blue hover:underline">Get one free</a>
          </p>
        </div>
      </div>
    </div>
  );
}
