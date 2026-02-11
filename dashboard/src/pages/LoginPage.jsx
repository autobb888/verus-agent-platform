import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';

const API_BASE = import.meta.env.VITE_API_URL || '';

export default function LoginPage() {
  const { getChallenge, login } = useAuth();
  const [mode, setMode] = useState('choose'); // choose, qr, manual
  const [step, setStep] = useState('start'); // start, challenge, signing
  const [challenge, setChallenge] = useState(null);
  const [qrChallenge, setQrChallenge] = useState(null);
  const [verusId, setVerusId] = useState('');
  const [signature, setSignature] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const pollIntervalRef = useRef(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  // QR Code Login Flow
  async function startQRLogin() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/auth/qr/challenge`, {
        credentials: 'include',
      });
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to get QR challenge');
      }
      
      setQrChallenge(data.data);
      setMode('qr');
      
      // Start polling for completion
      pollIntervalRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(`${API_BASE}/auth/qr/status/${data.data.challengeId}`, {
            credentials: 'include',
          });
          const statusData = await statusRes.json();
          
          if (statusData.data?.status === 'completed') {
            clearInterval(pollIntervalRef.current);
            // Redirect will happen via AuthContext detecting session
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

  // Manual CLI Login Flow
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
      // Redirect happens automatically via ProtectedRoute
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function resetToChoose() {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }
    setMode('choose');
    setStep('start');
    setQrChallenge(null);
    setChallenge(null);
    setError('');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <span className="text-4xl">⚡</span>
          <h1 className="text-2xl font-bold text-white mt-4">Verus Agent Platform</h1>
          <p className="text-gray-400 mt-2">Sign in with your VerusID</p>
        </div>

        <div className="bg-gray-800 rounded-xl p-6 shadow-xl border border-gray-700">
          
          {/* Choose Login Method */}
          {mode === 'choose' && (
            <div className="space-y-4">
              <p className="text-gray-300 text-center mb-6">
                Choose how you want to sign in:
              </p>
              
              <button
                onClick={startQRLogin}
                disabled={loading}
                className="w-full py-4 px-4 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-3"
              >
                <span className="text-2xl">📱</span>
                <div className="text-left">
                  <div className="font-semibold">Verus Mobile</div>
                  <div className="text-sm text-gray-500">Scan QR with Verus Mobile</div>
                </div>
              </button>
              
              <button
                onClick={() => { setMode('manual'); handleGetChallenge(); }}
                disabled={loading}
                className="w-full py-4 px-4 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-3"
              >
                <span className="text-2xl">💻</span>
                <div className="text-left">
                  <div className="font-semibold">CLI / Manual</div>
                  <div className="text-sm text-gray-400">Sign with Verus CLI</div>
                </div>
              </button>
            </div>
          )}

          {/* QR Code Login */}
          {mode === 'qr' && qrChallenge && (
            <div className="text-center">
              {/* Desktop: show QR code */}
              <div className="hidden md:block">
                <p className="text-gray-300 mb-4">
                  Scan with Verus Mobile to sign in:
                </p>
                
                <div className="bg-white p-4 rounded-lg inline-block mb-4">
                  <img 
                    src={qrChallenge.qrDataUrl} 
                    alt="Login QR Code" 
                    className="w-64 h-64"
                  />
                </div>
              </div>

              {/* Mobile: show deeplink button */}
              <div className="md:hidden">
                <p className="text-gray-300 mb-4">
                  Tap to sign in with Verus Mobile:
                </p>
                
                <a
                  href={qrChallenge.deeplink}
                  className="inline-flex items-center gap-3 px-6 py-4 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg transition-colors mb-4"
                >
                  <span className="text-2xl">📱</span>
                  Open Verus Mobile
                </a>
              </div>

              {/* Also show deeplink on desktop as fallback */}
              <div className="hidden md:block mb-2">
                <a
                  href={qrChallenge.deeplink}
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  Or tap here if on mobile →
                </a>
              </div>
              
              <p className="text-xs text-gray-500 mb-4">
                Expires: {new Date(qrChallenge.expiresAt).toLocaleTimeString()}
              </p>
              
              <div className="animate-pulse text-gray-400 mb-4">
                Waiting for signature...
              </div>
              
              <button
                onClick={resetToChoose}
                className="text-sm text-gray-400 hover:text-white transition-colors"
              >
                ← Back to login options
              </button>
            </div>
          )}

          {/* Manual CLI Login */}
          {mode === 'manual' && step === 'challenge' && challenge && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Sign this message with your Verus wallet:
                </label>
                <pre className="bg-gray-900 rounded-lg p-4 text-xs text-gray-300 overflow-x-auto whitespace-pre-wrap break-all border border-gray-700">
                  {challenge.challenge}
                </pre>
                <p className="text-xs text-gray-500 mt-2">
                  Expires: {new Date(challenge.expiresAt).toLocaleTimeString()}
                </p>
              </div>

              <div className="border-t border-gray-700 pt-4">
                <p className="text-sm text-gray-400 mb-4">
                  Use Verus CLI: <code className="bg-gray-900 px-2 py-1 rounded text-xs">verus signmessage "yourID@" "message"</code>
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Your VerusID
                </label>
                <input
                  type="text"
                  value={verusId}
                  onChange={(e) => setVerusId(e.target.value)}
                  placeholder="yourname@"
                  className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-verus-blue"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Signature
                </label>
                <textarea
                  value={signature}
                  onChange={(e) => setSignature(e.target.value)}
                  placeholder="Paste the signature here..."
                  rows={3}
                  className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-verus-blue font-mono text-sm"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loading || !verusId || !signature}
                className="w-full py-3 px-4 bg-verus-blue hover:bg-blue-600 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {loading ? 'Verifying...' : 'Sign In'}
              </button>

              <button
                type="button"
                onClick={resetToChoose}
                className="w-full py-2 text-sm text-gray-400 hover:text-white transition-colors"
              >
                ← Back to login options
              </button>
            </form>
          )}

          {error && (
            <div className="mt-4 p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}
        </div>

        <p className="text-center text-gray-500 text-sm mt-6">
          Don't have a VerusID?{' '}
          <a
            href="https://verus.io/wallet"
            target="_blank"
            rel="noopener noreferrer"
            className="text-verus-blue hover:underline"
          >
            Get one here
          </a>
        </p>
      </div>
    </div>
  );
}
