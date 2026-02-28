import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import HireModal from '../components/HireModal';
import ResolvedId from '../components/ResolvedId';
import TrustBadge from '../components/TrustBadge';
import TransparencyCard from '../components/TransparencyCard';
import DataPolicyBadge from '../components/DataPolicyBadge';

// In dev, use empty string to go through Vite proxy (avoids CORS)
const API_BASE = import.meta.env.VITE_API_URL || '';

function formatDuration(seconds) {
  if (seconds >= 3600) return `${Math.round(seconds / 3600)} hour${seconds >= 7200 ? 's' : ''}`;
  if (seconds >= 60) return `${Math.round(seconds / 60)} min`;
  return `${seconds}s`;
}

function formatBytes(bytes) {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${Math.round(bytes / 1048576)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export default function AgentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, requireAuth } = useAuth();
  const [agent, setAgent] = useState(null);
  const [verification, setVerification] = useState(null);
  const [reputation, setReputation] = useState(null);
  const [transparency, setTransparency] = useState(null);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hireService, setHireService] = useState(null);

  useEffect(() => {
    fetchAgent();
  }, [id]);

  async function fetchAgent() {
    try {
      const [agentRes, verifyRes, repRes, servicesRes, transRes] = await Promise.all([
        fetch(`${API_BASE}/v1/agents/${encodeURIComponent(id)}`, { credentials: 'include' }),
        fetch(`${API_BASE}/v1/agents/${encodeURIComponent(id)}/verification`, { credentials: 'include' }),
        fetch(`${API_BASE}/v1/reputation/${encodeURIComponent(id)}`, { credentials: 'include' }),
        fetch(`${API_BASE}/v1/services/agent/${encodeURIComponent(id)}`, { credentials: 'include' }),
        fetch(`${API_BASE}/v1/agents/${encodeURIComponent(id)}/transparency`, { credentials: 'include' }).catch(() => ({ ok: false })),
      ]);
      
      const agentData = await agentRes.json();
      const verifyData = await verifyRes.json();
      const repData = await repRes.json();
      const servicesData = await servicesRes.json();
      const transData = transRes.ok ? await transRes.json() : {};
      
      if (agentData.data) {
        setAgent(agentData.data);
      } else {
        setError(agentData.error?.message || 'Agent not found');
      }
      
      if (verifyData.data) {
        setVerification(verifyData.data);
      }
      
      if (repData.data) {
        setReputation(repData.data);
      }
      
      if (servicesData.data) {
        setServices(servicesData.data);
      }
      
      if (transData.data) {
        setTransparency(transData.data);
      }
    } catch {
      setError('Failed to fetch agent');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12" role="status" aria-label="Loading">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-verus-blue"></div>
        <span className="sr-only">Loading...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="text-red-400 mb-4">{error}</div>
        <Link to="/" className="text-verus-blue hover:underline">← Back to agents</Link>
      </div>
    );
  }

  if (!agent) return null;

  // Status badges now use CSS classes from index.css

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-6">
        <Link to="/" className="text-gray-400 hover:text-white transition-colors">
          ← Back to agents
        </Link>
      </div>

      {/* Header */}
      <div className="card mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {agent.name}
              {transparency && <TrustBadge level={transparency.trustLevel} score={transparency.trustScore} />}
            </h1>
            <div className="mt-2">
              <ResolvedId address={agent.verusId} name={agent.name} size="md" />
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`badge badge-${agent.status}`}>
              {agent.status}
            </span>
            <span className="px-3 py-1 bg-gray-700 text-gray-300 rounded-full text-sm capitalize">
              {agent.type}
            </span>
            {agent.protocols?.length > 0 && agent.protocols.map((proto) => (
              <span key={proto} className="px-2 py-0.5 bg-gray-700 text-gray-300 rounded-full text-xs">
                {proto}
              </span>
            ))}
          </div>
        </div>
        
        {agent.description && (
          <p className="text-gray-300 mt-4">{agent.description}</p>
        )}
        
        <div className="flex gap-6 mt-6 pt-4 border-t border-gray-700 text-sm text-gray-400">
          <div>
            <span className="text-gray-500">Owner:</span>{' '}
            <ResolvedId address={agent.owner} size="sm" showAddress={true} />
          </div>
          <div>
            <span className="text-gray-500">Created:</span>{' '}
            <span className="text-gray-300">{new Date(agent.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
      </div>

      {/* Reputation */}
      {reputation && (
        <div className="card mb-6">
          <h2 className="text-lg font-semibold text-white mb-4">Reputation</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="bg-gray-900 rounded-lg p-4 text-center">
              <div className="text-3xl font-bold text-yellow-400">
                {reputation.score ? reputation.score.toFixed(1) : '—'}
              </div>
              <div className="text-sm text-gray-400 flex items-center justify-center gap-1">
                <span className="text-yellow-400">★</span> Score
              </div>
            </div>
            <div className="bg-gray-900 rounded-lg p-4 text-center">
              <div className="text-3xl font-bold text-white">{reputation.totalReviews}</div>
              <div className="text-sm text-gray-400">Reviews</div>
            </div>
            <div className="bg-gray-900 rounded-lg p-4 text-center">
              <div className="text-3xl font-bold text-white">{reputation.uniqueReviewers}</div>
              <div className="text-sm text-gray-400">Reviewers</div>
            </div>
            <div className="bg-gray-900 rounded-lg p-4 text-center">
              <div className={`text-3xl font-bold ${
                reputation.trending === 'up' ? 'text-green-400' : 
                reputation.trending === 'down' ? 'text-red-400' : 'text-gray-400'
              }`}>
                {reputation.trending === 'up' ? '↑' : reputation.trending === 'down' ? '↓' : '—'}
              </div>
              <div className="text-sm text-gray-400">Trend</div>
            </div>
          </div>
          
          {/* Rating Distribution */}
          {reputation.transparency?.reviewDistribution && (
            <div className="bg-gray-900 rounded-lg p-4">
              <div className="text-sm text-gray-400 mb-3">{reputation.transparency.note}</div>
              <div className="space-y-2">
                {[5, 4, 3, 2, 1].map((rating) => {
                  const dist = reputation.transparency.reviewDistribution.find(d => d.rating === rating);
                  const count = dist?.count || 0;
                  const pct = reputation.totalReviews > 0 ? (count / reputation.totalReviews) * 100 : 0;
                  return (
                    <div key={rating} className="flex items-center gap-2">
                      <span className="text-sm text-gray-400 w-8">{rating}★</span>
                      <div className="flex-1 bg-gray-800 rounded-full h-2 overflow-hidden">
                        <div
                          className="bg-yellow-500 h-full rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-sm text-gray-500 w-8 text-right">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          
          {/* Sybil Flags */}
          {reputation.sybilFlags && reputation.sybilFlags.length > 0 && (
            <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
              <div className="text-sm font-medium text-red-400 mb-2">⚠️ Suspicious Patterns Detected</div>
              {reputation.sybilFlags.map((flag, i) => (
                <div key={i} className="text-xs text-red-300">
                  [{flag.severity}] {flag.description}
                </div>
              ))}
            </div>
          )}
          
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-700">
            <span className={`badge ${
              reputation.confidence === 'high' ? 'badge-completed' :
              reputation.confidence === 'medium' ? 'badge-requested' :
              reputation.confidence === 'low' ? 'badge-disputed' :
              'badge-cancelled'
            }`}>
              {reputation.confidence} confidence
            </span>
            <span className="text-xs text-gray-400">
              {reputation.recentReviews} reviews in last 30 days
            </span>
          </div>
        </div>
      )}

      {/* Transparency */}
      <TransparencyCard verusId={agent.verusId} />
      <DataPolicyBadge verusId={agent.verusId} />

      {/* Services */}
      {services.length > 0 && (
        <div className="card mb-6">
          <h2 className="text-lg font-semibold text-white mb-4">Services</h2>
          <div className="space-y-3">
            {services.map((service) => (
              <div key={service.id} className="bg-gray-900 rounded-lg p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-medium text-white">{service.name}</h3>
                    {service.description && (
                      <p className="text-sm text-gray-400 mt-1">{service.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                      {service.category && <span>📁 {service.category}</span>}
                      {service.turnaround && <span>⏱ {service.turnaround}</span>}
                    </div>
                    {service.sessionParams && Object.keys(service.sessionParams).length > 0 && (
                      <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-gray-400">
                        {service.sessionParams.duration != null && (
                          <span>⏳ {formatDuration(service.sessionParams.duration)}</span>
                        )}
                        {service.sessionParams.tokenLimit != null && (
                          <span>🔤 {service.sessionParams.tokenLimit.toLocaleString()} tokens</span>
                        )}
                        {service.sessionParams.imageLimit != null && (
                          <span>🖼 {service.sessionParams.imageLimit.toLocaleString()} images</span>
                        )}
                        {service.sessionParams.messageLimit != null && (
                          <span>💬 {service.sessionParams.messageLimit.toLocaleString()} messages</span>
                        )}
                        {service.sessionParams.maxFileSize != null && (
                          <span>📎 {formatBytes(service.sessionParams.maxFileSize)}</span>
                        )}
                        {service.sessionParams.allowedFileTypes && (
                          <span>📄 {service.sessionParams.allowedFileTypes}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="text-right flex flex-col items-end gap-2">
                    <div className="text-lg font-bold text-verus-blue">
                      {service.price} {service.currency}
                    </div>
                    <button
                      onClick={() => {
                        if (!user) { requireAuth(); return; }
                        setHireService({ ...service, verusId: agent.verusId, agentName: agent.name });
                      }}
                      className="btn-primary text-sm"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M8 9a3 3 0 100-6 3 3 0 000 6zM8 11a6 6 0 016 6H2a6 6 0 016-6zM16 7a1 1 0 10-2 0v1h-1a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1V7z" />
                      </svg>
                      Hire
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Capabilities */}
      {agent.capabilities && agent.capabilities.length > 0 && (
        <div className="card mb-6">
          <h2 className="text-lg font-semibold text-white mb-4">Capabilities</h2>
          <div className="space-y-3">
            {agent.capabilities.map((cap, i) => (
              <div key={i} className="bg-gray-900 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-white">{cap.name}</span>
                  {cap.protocol && (
                    <span className="text-xs text-gray-400 bg-gray-800 px-2 py-1 rounded">
                      {cap.protocol}
                    </span>
                  )}
                </div>
                {cap.description && (
                  <p className="text-sm text-gray-400 mt-1">{cap.description}</p>
                )}
                {cap.endpoint && (
                  <p className="text-xs text-gray-400 mt-2 font-mono">{cap.endpoint}</p>
                )}
                {cap.pricing && (
                  <div className="mt-2">
                    {cap.pricing.model === 'free' ? (
                      <span className="px-2 py-0.5 bg-green-500/20 text-green-400 rounded text-xs font-medium">Free</span>
                    ) : (
                      <span className="text-xs text-gray-400">
                        {cap.pricing.amount} {cap.pricing.currency}{cap.pricing.model !== 'per_call' ? ` / ${cap.pricing.model}` : ' / call'}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Endpoints & Verification */}
      {agent.endpoints && agent.endpoints.length > 0 && (
        <div className="card mb-6">
          <h2 className="text-lg font-semibold text-white mb-4">Endpoints</h2>
          <div className="space-y-3">
            {agent.endpoints.map((ep, i) => {
              const epVerify = verification?.endpoints?.find(v => v.endpointId === ep.id);
              return (
                <div key={i} className="bg-gray-900 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm text-gray-300" title={ep.url}>{ep.url}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 bg-gray-800 px-2 py-1 rounded">
                        {ep.protocol}
                      </span>
                      {ep.verified ? (
                        <span className="text-green-400 text-xs flex items-center gap-1">
                          ✓ Verified
                        </span>
                      ) : (
                        <span className="text-yellow-400 text-xs">
                          ⏳ {epVerify?.status || 'Pending'}
                        </span>
                      )}
                    </div>
                  </div>
                  {epVerify && (
                    <div className="mt-2 text-xs text-gray-400">
                      {epVerify.verifiedAt && (
                        <span>Last verified: {new Date(epVerify.verifiedAt).toLocaleString()}</span>
                      )}
                      {epVerify.nextVerificationAt && (
                        <span className="ml-4">
                          Next check: {new Date(epVerify.nextVerificationAt).toLocaleString()}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Hire Modal */}
      {hireService && (
        <HireModal
          key={hireService.id}
          service={hireService}
          agent={{ name: agent.name, id: agent.verusId }}
          onClose={() => setHireService(null)}
          onSuccess={(job) => {
            navigate(`/jobs/${job.id}`);
          }}
        />
      )}
    </div>
  );
}
