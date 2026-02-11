import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// In dev, use empty string to go through Vite proxy (avoids CORS)
const API_BASE = import.meta.env.VITE_API_URL || '';

export default function RegisterAgentPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  
  const [formData, setFormData] = useState({
    verusId: '',
    name: '',
    type: 'autonomous',
    description: '',
  });
  const [signature, setSignature] = useState('');
  const [payload, setPayload] = useState(null);
  const [step, setStep] = useState('form'); // form, sign, complete
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function generatePayload() {
    const nonce = crypto.randomUUID();
    const timestamp = Math.floor(Date.now() / 1000);
    
    const data = {
      verusId: formData.verusId,
      timestamp,
      nonce,
      action: 'register',
      data: {
        name: formData.name,
        type: formData.type,
        description: formData.description || undefined,
        owner: user.verusId,
      },
    };
    
    setPayload(data);
    setStep('sign');
  }

  async function handleSubmit() {
    if (!payload || !signature) return;
    
    setLoading(true);
    setError('');
    
    try {
      const res = await fetch(`${API_BASE}/v1/agents/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...payload, signature }),
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error?.message || 'Registration failed');
      }
      
      setStep('complete');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (step === 'complete') {
    return (
      <div className="max-w-2xl mx-auto text-center py-12">
        <div className="text-5xl mb-4">🎉</div>
        <h1 className="text-2xl font-bold text-white mb-2">Agent Registered!</h1>
        <p className="text-gray-400 mb-6">
          Your agent has been registered and endpoint verification has started.
        </p>
        <Link
          to="/"
          className="inline-block px-6 py-3 bg-verus-blue hover:bg-blue-600 text-white font-medium rounded-lg transition-colors"
        >
          View My Agents
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Breadcrumb */}
      <div className="mb-6">
        <Link to="/" className="text-gray-400 hover:text-white transition-colors">
          ← Back to agents
        </Link>
      </div>

      <h1 className="text-2xl font-bold text-white mb-6">Register New Agent</h1>

      {error && (
        <div className="mb-6 p-4 bg-red-900/30 border border-red-800 rounded-lg text-red-400">
          {error}
        </div>
      )}

      {step === 'form' && (
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Agent VerusID *
              </label>
              <input
                type="text"
                value={formData.verusId}
                onChange={(e) => setFormData({ ...formData, verusId: e.target.value })}
                placeholder="my-agent@"
                className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-verus-blue"
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                The VerusID that will own this agent
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Name *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="My Agent"
                className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-verus-blue"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Type *
              </label>
              <select
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-verus-blue"
              >
                <option value="autonomous">Autonomous</option>
                <option value="assisted">Assisted</option>
                <option value="hybrid">Hybrid</option>
                <option value="tool">Tool</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Description
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="What does your agent do?"
                rows={3}
                className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-verus-blue"
              />
            </div>

            <button
              onClick={generatePayload}
              disabled={!formData.verusId || !formData.name}
              className="w-full py-3 px-4 bg-verus-blue hover:bg-blue-600 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              Continue to Sign
            </button>
          </div>
        </div>
      )}

      {step === 'sign' && payload && (
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Sign this payload with your VerusID ({payload.verusId}):
            </label>
            <pre className="bg-gray-900 rounded-lg p-4 text-xs text-gray-300 overflow-x-auto whitespace-pre-wrap break-all border border-gray-700">
              {JSON.stringify(payload, null, 2)}
            </pre>
          </div>

          <div className="border-t border-gray-700 pt-4">
            <p className="text-sm text-gray-400 mb-2">
              Use Verus CLI to sign the JSON payload:
            </p>
            <code className="block bg-gray-900 px-3 py-2 rounded text-xs text-gray-300 overflow-x-auto">
              verus signmessage "{payload.verusId}" '{JSON.stringify(payload)}'
            </code>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Paste Signature
            </label>
            <textarea
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              placeholder="Paste the signature here..."
              rows={3}
              className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-verus-blue font-mono text-sm"
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep('form')}
              className="flex-1 py-3 px-4 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors"
            >
              ← Back
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading || !signature}
              className="flex-1 py-3 px-4 bg-verus-blue hover:bg-blue-600 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {loading ? 'Registering...' : 'Register Agent'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
