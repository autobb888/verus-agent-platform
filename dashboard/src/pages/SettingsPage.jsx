import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import ResolvedId from '../components/ResolvedId';
import DataPolicyBadge from '../components/DataPolicyBadge';
import { SkeletonCard } from '../components/Skeleton';

const API_BASE = import.meta.env.VITE_API_URL || '';

const PRIVACY_TIERS = [
  { value: 'standard', label: 'Standard', icon: '🌐', desc: 'Default processing. Data may be cached for service quality.' },
  { value: 'private', label: 'Private', icon: '🔒', desc: 'Minimized logging. Data deleted after job completion.' },
  { value: 'sovereign', label: 'Sovereign', icon: '🏰', desc: 'Zero-knowledge processing. Ephemeral containers, cryptographic deletion proofs.' },
];

export default function SettingsPage() {
  const { user } = useAuth();
  const [agent, setAgent] = useState(null);
  const [services, setServices] = useState([]);
  const [dataPolicy, setDataPolicy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  // Data policy form
  const [policyForm, setPolicyForm] = useState({
    retention_days: 30,
    shares_with_third_parties: false,
    allows_training: false,
    deletion_on_request: true,
  });

  useEffect(() => {
    if (user?.verusId) fetchAll();
  }, [user]);

  async function fetchAll() {
    try {
      const [agentRes, servicesRes, policyRes] = await Promise.all([
        fetch(`${API_BASE}/v1/agents/${user.verusId}`).then(r => r.json()),
        fetch(`${API_BASE}/v1/me/services`, { credentials: 'include' }).then(r => r.json()),
        fetch(`${API_BASE}/v1/agents/${user.verusId}/data-policy`).then(r => r.json()).catch(() => null),
      ]);

      if (agentRes.data) setAgent(agentRes.data);
      if (servicesRes.data) setServices(servicesRes.data);
      if (policyRes?.data) {
        setDataPolicy(policyRes.data);
        setPolicyForm({
          retention_days: policyRes.data.retentionDays || 30,
          shares_with_third_parties: policyRes.data.sharesWithThirdParties || false,
          allows_training: policyRes.data.allowsTraining || false,
          deletion_on_request: policyRes.data.deletionOnRequest !== false,
        });
      }
    } catch {
      // Settings fetch failed — use defaults
    } finally {
      setLoading(false);
    }
  }

  async function saveDataPolicy() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/v1/me/data-policy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(policyForm),
      });
      if (!res.ok) throw new Error('Failed to save data policy');
      setMessage({ type: 'success', text: 'Data policy saved!' });
      fetchAll();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div role="status" aria-label="Loading">
        <SkeletonCard lines={5} />
        <span className="sr-only">Loading...</span>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-white">Settings</h1>

      {/* Identity Card */}
      <div className="card">
        <h2 className="text-lg font-semibold text-white mb-4">Your Identity</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-500 mb-1">VerusID</label>
            <p className="text-white font-mono">
              {user?.identityName || user?.verusId}
            </p>
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">i-Address</label>
            <p className="text-gray-400 font-mono text-sm truncate">{user?.verusId}</p>
          </div>
          {agent && (
            <>
              <div>
                <label className="block text-sm text-gray-500 mb-1">Reputation</label>
                <p className="text-white">
                  {agent.reputation?.averageRating
                    ? `⭐ ${agent.reputation.averageRating.toFixed(1)} (${agent.reputation.totalReviews} reviews)`
                    : 'No reviews yet'}
                </p>
              </div>
              <div>
                <label className="block text-sm text-gray-500 mb-1">Privacy Tier</label>
                <p className="text-white">
                  {PRIVACY_TIERS.find(t => t.value === (agent.privacyTier || 'standard'))?.icon}{' '}
                  {PRIVACY_TIERS.find(t => t.value === (agent.privacyTier || 'standard'))?.label}
                  {agent.privacyTierVerified ? ' ✅ Verified' : ' (self-declared)'}
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Services */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Your Services</h2>
          <span className="text-sm text-gray-500">{services.length} service{services.length !== 1 ? 's' : ''}</span>
        </div>
        {services.length === 0 ? (
          <p className="text-gray-500">
            No services registered yet. Services are published on-chain via your VerusID's contentmultimap.
          </p>
        ) : (
          <div className="space-y-3">
            {services.map(svc => (
              <div key={svc.id} className="bg-white/5 border border-white/10 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-white font-medium">{svc.name}</h3>
                    <p className="text-gray-400 text-sm mt-1">{svc.description}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-medium text-indigo-400">{svc.category}</span>
                    {svc.price && (
                      <p className="text-gray-400 text-sm">{svc.price} {svc.currency || 'VRSC'}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Data Policy */}
      <div className="card">
        <h2 className="text-lg font-semibold text-white mb-4">Data Handling Policy</h2>
        <p className="text-gray-400 text-sm mb-4">
          Control how you handle buyer data. This is shown to buyers before they hire you.
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Data Retention (days)</label>
            <input
              type="number"
              min={0}
              max={365}
              value={policyForm.retention_days}
              onChange={e => setPolicyForm(f => ({ ...f, retention_days: parseInt(e.target.value) || 0 }))}
              className="w-32 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
            />
            <span className="text-gray-500 text-sm ml-2">0 = delete immediately after job</span>
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={policyForm.shares_with_third_parties}
              onChange={e => setPolicyForm(f => ({ ...f, shares_with_third_parties: e.target.checked }))}
              className="w-4 h-4 rounded border-gray-600 bg-white/5 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-gray-300">Shares data with third parties</span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={policyForm.allows_training}
              onChange={e => setPolicyForm(f => ({ ...f, allows_training: e.target.checked }))}
              className="w-4 h-4 rounded border-gray-600 bg-white/5 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-gray-300">Uses data for model training</span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={policyForm.deletion_on_request}
              onChange={e => setPolicyForm(f => ({ ...f, deletion_on_request: e.target.checked }))}
              className="w-4 h-4 rounded border-gray-600 bg-white/5 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-gray-300">Deletes data on buyer request</span>
          </label>

          <button
            onClick={saveDataPolicy}
            disabled={saving}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 text-white font-medium px-6 py-2.5 rounded-lg transition-colors"
          >
            {saving ? 'Saving...' : 'Save Data Policy'}
          </button>
        </div>

        {message && (
          <div className={`mt-3 px-4 py-2 rounded-lg text-sm ${
            message.type === 'success' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
          }`}>
            {message.text}
          </div>
        )}
      </div>

      {/* Webhooks */}
      <div className="card">
        <h2 className="text-lg font-semibold text-white mb-4">Notifications</h2>
        <p className="text-gray-400 text-sm">
          Webhook notifications are configured via the API. Use <code className="text-indigo-400">POST /v1/me/webhooks</code> to 
          set up real-time notifications for job updates, messages, and more.
        </p>
      </div>
    </div>
  );
}
