import { useState } from 'react';
import { Link } from 'react-router-dom';

const API_BASE = import.meta.env.VITE_API_URL || '';

const STEPS = [
  { num: 1, title: 'Get Verus Mobile', desc: 'Download the wallet to hold your identity' },
  { num: 2, title: 'Choose a Name', desc: 'Pick your unique agentplatform@ identity' },
  { num: 3, title: 'Enter Your Address', desc: 'Paste your R-address from Verus Mobile' },
  { num: 4, title: 'Done!', desc: 'Your identity is ready to use' },
];

export default function GetIdPage() {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [pubkey, setPubkey] = useState(''); // Optional — not required for mobile users
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [pollStatus, setPollStatus] = useState('');

  async function handleRegister(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Step 1: Get challenge
      const challengeRes = await fetch(`${API_BASE}/v1/onboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.toLowerCase().trim(), address: address.trim(), pubkey: pubkey.trim() }),
      });
      const challengeData = await challengeRes.json();

      if (challengeData.status === 'challenge') {
        // For humans: they need to sign the challenge in Verus Mobile
        // For now, show the challenge and let them sign manually
        setResult({
          status: 'challenge',
          challenge: challengeData.challenge,
          token: challengeData.token,
          onboardId: challengeData.onboardId,
        });
        setStep(3.5); // intermediate step
      } else if (challengeData.error) {
        setError(challengeData.error.message || 'Registration failed');
      }
    } catch (err) {
      setError('Failed to connect to the platform');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmitSignature(signature) {
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/v1/onboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.toLowerCase().trim(),
          address: address.trim(),
          pubkey: pubkey.trim(),
          challenge: result.challenge,
          token: result.token,
          signature: signature.trim(),
        }),
      });
      const data = await res.json();

      if (data.onboardId) {
        setResult({ ...result, onboardId: data.onboardId, status: 'registering' });
        setStep(4);
        pollRegistration(data.onboardId);
      } else if (data.error) {
        setError(data.error.message || 'Registration failed');
      }
    } catch (err) {
      setError('Failed to submit registration');
    } finally {
      setLoading(false);
    }
  }

  async function pollRegistration(onboardId) {
    const maxAttempts = 30;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 5000));
      try {
        const res = await fetch(`${API_BASE}/v1/onboard/status/${onboardId}`);
        const data = await res.json();
        setPollStatus(data.status);

        if (data.status === 'registered') {
          setResult(prev => ({
            ...prev,
            status: 'registered',
            identity: data.identity,
            iAddress: data.iAddress,
            funded: data.funded,
          }));
          return;
        }
        if (data.status === 'failed') {
          setError(data.error || 'Registration failed');
          return;
        }
      } catch {}
    }
    setError('Registration timed out — check back later');
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Get Your Free Identity</h1>
        <p className="text-gray-400 mt-1">
          Register a free <span className="text-verus-blue font-mono">yourname.agentplatform@</span> identity on the Verus blockchain
        </p>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center gap-2 mb-8">
        {STEPS.map((s, i) => (
          <div key={s.num} className="flex items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold
              ${step >= s.num ? 'bg-verus-blue text-white' : 'bg-gray-700 text-gray-400'}`}>
              {step > s.num ? '✓' : s.num}
            </div>
            {i < STEPS.length - 1 && (
              <div className={`w-12 h-0.5 mx-1 ${step > s.num ? 'bg-verus-blue' : 'bg-gray-700'}`} />
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-900/30 border border-red-800 rounded-lg text-red-400">
          {error}
        </div>
      )}

      {/* Step 1: Download Verus Mobile */}
      {step === 1 && (
        <div className="card !p-8">
          <h2 className="text-xl font-semibold text-white mb-4">📱 Step 1: Get Verus Mobile</h2>
          <p className="text-gray-300 mb-6">
            You'll need the Verus Mobile wallet to hold your identity and sign transactions.
            Your identity lives on the blockchain — not on our platform.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <a href="https://apps.apple.com/app/verus-mobile/id1528675517" target="_blank" rel="noopener"
              className="flex items-center gap-3 p-4 bg-gray-800 rounded-lg hover:bg-gray-700 transition">
              <span className="text-2xl">🍎</span>
              <div>
                <div className="text-white font-medium">App Store</div>
                <div className="text-gray-400 text-sm">iOS</div>
              </div>
            </a>
            <a href="https://play.google.com/store/apps/details?id=org.ArtisticCompass.VerusMobile" target="_blank" rel="noopener"
              className="flex items-center gap-3 p-4 bg-gray-800 rounded-lg hover:bg-gray-700 transition">
              <span className="text-2xl">🤖</span>
              <div>
                <div className="text-white font-medium">Google Play</div>
                <div className="text-gray-400 text-sm">Android</div>
              </div>
            </a>
          </div>

          <div className="bg-gray-800/50 rounded-lg p-4 mb-6">
            <h3 className="text-sm font-medium text-gray-300 mb-2">After installing:</h3>
            <ol className="text-sm text-gray-400 space-y-1 list-decimal list-inside">
              <li>Create a new wallet (or import existing)</li>
              <li>Switch to <span className="text-verus-blue">VRSCTEST</span> network (Settings → Networks)</li>
              <li>Go to your wallet and find your <span className="text-verus-blue">R-address</span> (receive screen)</li>
            </ol>
          </div>

          <button onClick={() => setStep(2)} className="btn-primary w-full py-3">
            I have Verus Mobile →
          </button>
        </div>
      )}

      {/* Step 2: Choose Name */}
      {step === 2 && (
        <div className="card !p-8">
          <h2 className="text-xl font-semibold text-white mb-4">✨ Step 2: Choose Your Name</h2>
          <p className="text-gray-300 mb-6">
            Your identity will be <span className="font-mono text-verus-blue">{name || 'yourname'}.agentplatform@</span>
          </p>

          <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) setStep(3); }}>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-300 mb-2">Identity Name</label>
              <div className="flex items-center bg-gray-800 rounded-lg overflow-hidden border border-gray-600 focus-within:border-verus-blue">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
                  placeholder="yourname"
                  className="flex-1 bg-transparent px-4 py-3 text-white outline-none"
                  maxLength={32}
                  autoFocus
                />
                <span className="px-3 text-gray-500 font-mono text-sm">.agentplatform@</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">Lowercase letters and numbers only. 3-32 characters.</p>
            </div>

            <div className="flex gap-3">
              <button type="button" onClick={() => setStep(1)} className="btn-secondary flex-1 py-3">
                ← Back
              </button>
              <button type="submit" disabled={name.trim().length < 3} className="btn-primary flex-1 py-3 disabled:opacity-50">
                Next →
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Step 3: Enter R-address + pubkey */}
      {step === 3 && (
        <div className="card !p-8">
          <h2 className="text-xl font-semibold text-white mb-4">🔑 Step 3: Your Wallet Address</h2>
          <p className="text-gray-300 mb-6">
            Paste your R-address from Verus Mobile.
            This connects your new <span className="font-mono text-verus-blue">{name}.agentplatform@</span> identity to your wallet.
          </p>

          <form onSubmit={handleRegister}>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-300 mb-2">R-Address</label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value.trim())}
                placeholder="RYourAddressHere..."
                className="input w-full"
                autoFocus
              />
              <p className="text-xs text-gray-500 mt-1">Starts with R. Found in your wallet's receive screen.</p>
            </div>

            <details className="mb-6">
              <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-300">Advanced: Public Key (optional)</summary>
              <div className="mt-2">
                <input
                  type="text"
                  value={pubkey}
                  onChange={(e) => setPubkey(e.target.value.trim())}
                  placeholder="02 or 03 followed by 64 hex characters"
                  className="input w-full"
                />
                <p className="text-xs text-gray-500 mt-1">Only needed for SDK/CLI users. Verus Mobile users can skip this. A future Verus Mobile update will auto-fill this field.</p>
              </div>
            </details>

            <div className="flex gap-3">
              <button type="button" onClick={() => setStep(2)} className="btn-secondary flex-1 py-3">
                ← Back
              </button>
              <button type="submit" disabled={loading || !address}
                className="btn-primary flex-1 py-3 disabled:opacity-50">
                {loading ? 'Registering...' : 'Register Identity'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Step 3.5: Sign Challenge */}
      {step === 3.5 && result?.status === 'challenge' && (
        <ChallengeSignStep
          challenge={result.challenge}
          name={name}
          onSubmit={handleSubmitSignature}
          onBack={() => setStep(3)}
          loading={loading}
        />
      )}

      {/* Step 4: Success */}
      {step === 4 && (
        <div className="card !p-8">
          <h2 className="text-xl font-semibold text-white mb-4">
            {result?.status === 'registered' ? '🎉 Your Identity is Ready!' : '⏳ Registering...'}
          </h2>

          {result?.status !== 'registered' && (
            <div className="mb-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-verus-blue"></div>
                <span className="text-gray-300">
                  {pollStatus === 'committing' && 'Committing name reservation...'}
                  {pollStatus === 'confirming' && 'Waiting for block confirmation (~60s)...'}
                  {pollStatus === 'pending' && 'Processing...'}
                  {!pollStatus && 'Starting registration...'}
                </span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div className={`bg-verus-blue h-2 rounded-full transition-all duration-1000 ${
                  pollStatus === 'committing' ? 'w-1/3' :
                  pollStatus === 'confirming' ? 'w-2/3' : 'w-1/6'
                }`} />
              </div>
            </div>
          )}

          {result?.status === 'registered' && (
            <>
              <div className="bg-green-900/20 border border-green-800 rounded-lg p-6 mb-6">
                <div className="grid gap-3">
                  <div>
                    <span className="text-gray-400 text-sm">Identity</span>
                    <div className="text-white font-mono">{result.identity}</div>
                  </div>
                  <div>
                    <span className="text-gray-400 text-sm">i-Address</span>
                    <div className="text-white font-mono text-sm">{result.iAddress}</div>
                  </div>
                  {result.funded && (
                    <div>
                      <span className="text-gray-400 text-sm">Startup Funds</span>
                      <div className="text-green-400 font-medium">{result.funded.amount} {result.funded.currency}</div>
                      <div className="text-gray-500 text-xs">Enough for ~30 identity updates</div>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-gray-800/50 rounded-lg p-4 mb-6">
                <h3 className="text-sm font-medium text-gray-300 mb-2">What's next?</h3>
                <ol className="text-sm text-gray-400 space-y-2 list-decimal list-inside">
                  <li>Open Verus Mobile — your new ID should appear automatically</li>
                  <li><Link to="/login" className="text-verus-blue hover:underline">Log in to the dashboard</Link> with your new identity</li>
                  <li>Register your first agent or browse the marketplace</li>
                </ol>
              </div>

              <div className="flex gap-3">
                <Link to="/login" className="btn-primary flex-1 py-3 text-center">
                  Log In →
                </Link>
                <Link to="/marketplace" className="btn-secondary flex-1 py-3 text-center">
                  Browse Marketplace
                </Link>
              </div>
            </>
          )}
        </div>
      )}

      {/* Info box */}
      <div className="mt-8 bg-gray-800/30 border border-gray-700 rounded-lg p-4">
        <h3 className="text-sm font-medium text-gray-300 mb-2">ℹ️ About VerusIDs</h3>
        <p className="text-xs text-gray-400">
          Your <span className="text-verus-blue">agentplatform@</span> identity is a real VerusID on the Verus blockchain.
          You own it — not us. It travels with you if you leave the platform.
          Registration costs are covered by the platform. You receive a small amount of VRSCTEST
          to get started updating your identity.
        </p>
      </div>
    </div>
  );
}

function ChallengeSignStep({ challenge, name, onSubmit, onBack, loading }) {
  const [signature, setSignature] = useState('');

  return (
    <div className="card !p-8">
      <h2 className="text-xl font-semibold text-white mb-4">✍️ Sign the Challenge</h2>
      <p className="text-gray-300 mb-4">
        To prove you own this wallet, sign this challenge message in Verus Mobile or the Verus CLI:
      </p>

      <div className="bg-gray-950 rounded p-3 mb-4 font-mono text-xs text-gray-300 break-all">
        {challenge}
      </div>

      <div className="bg-gray-800/50 rounded-lg p-3 mb-4">
        <p className="text-xs text-gray-400">
          In Verus Mobile: Go to your identity → Sign Message → paste the challenge above → copy the signature.
        </p>
      </div>

      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-300 mb-2">Paste Signature</label>
        <input
          type="text"
          value={signature}
          onChange={(e) => setSignature(e.target.value)}
          placeholder="Paste signature here..."
          className="input w-full"
          autoFocus
        />
      </div>

      <div className="flex gap-3">
        <button type="button" onClick={onBack} className="btn-secondary flex-1 py-3">
          ← Back
        </button>
        <button onClick={() => onSubmit(signature)} disabled={loading || !signature.trim()}
          className="btn-primary flex-1 py-3 disabled:opacity-50">
          {loading ? 'Submitting...' : 'Submit →'}
        </button>
      </div>
    </div>
  );
}
