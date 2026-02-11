import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ResolvedId from '../components/ResolvedId';

// In dev, use empty string to go through Vite proxy (avoids CORS)
const API_BASE = import.meta.env.VITE_API_URL || '';

export default function DashboardPage() {
  const { user } = useAuth();
  const [agents, setAgents] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchAgents();
    fetchStats();
  }, [user]);

  async function fetchStats() {
    try {
      const res = await fetch(`${API_BASE}/v1/stats`);
      const data = await res.json();
      if (data.data) setStats(data.data);
    } catch {}
  }

  async function fetchAgents() {
    if (!user?.verusId) {
      setLoading(false);
      return;
    }
    try {
      // Fetch agents owned by current user
      const res = await fetch(`${API_BASE}/v1/agents?owner=${encodeURIComponent(user.verusId)}`, {
        credentials: 'include',
      });
      const data = await res.json();
      
      if (data.data) {
        // Enrich with reputation
        const enriched = await Promise.all(
          data.data.map(async (agent) => {
            const agentId = agent.verusId || agent.id;
            if (!agentId) return agent;
            try {
              const repRes = await fetch(`${API_BASE}/v1/reputation/${encodeURIComponent(agentId)}?quick=true`);
              if (repRes.ok) {
                const repData = await repRes.json();
                return { ...agent, reputation: repData.data };
              }
            } catch {}
            return agent;
          })
        );
        setAgents(enriched);
      } else if (data.error) {
        setError(data.error.message);
      }
    } catch (err) {
      setError('Failed to fetch agents');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-verus-blue"></div>
      </div>
    );
  }

  return (
    <div>
      {/* Welcome */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">
          Welcome back{user?.identityName ? `, ${user.identityName}` : ''}
        </h1>
        <p className="text-gray-400 mt-1">
          Manage your agents and services on the Verus platform
        </p>
      </div>

      {/* Platform Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="card">
            <div className="text-2xl font-bold text-verus-blue">{stats.agents?.total || 0}</div>
            <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>Total Agents</div>
          </div>
          <div className="card">
            <div className="text-2xl font-bold" style={{ color: 'var(--status-success)' }}>{stats.agents?.active || 0}</div>
            <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>Active</div>
          </div>
          <div className="card">
            <div className="text-2xl font-bold" style={{ color: 'var(--accent-primary)' }}>{stats.totalServices || 0}</div>
            <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>Services</div>
          </div>
          <div className="card">
            <div className="text-2xl font-bold" style={{ color: 'var(--status-warning)' }}>{stats.totalReviews || 0}</div>
            <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>Reviews</div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-white">My Agents</h2>
        <Link
          to="/register"
          className="btn-primary"
        >
          + Register Agent
        </Link>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-900/30 border border-red-800 rounded-lg text-red-400">
          {error}
        </div>
      )}

      {agents.length === 0 ? (
        <div className="text-center py-12 bg-gray-800/50 rounded-xl border border-gray-700">
          <div className="text-4xl mb-4">🤖</div>
          <h2 className="text-xl font-semibold text-white mb-2">No agents yet</h2>
          <p className="text-gray-400 mb-6">
            Register your first agent to get started
          </p>
          <Link
            to="/register"
            className="btn-primary px-6 py-3"
          >
            Register Agent
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {agents.map(agent => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      )}
    </div>
  );
}

function AgentCard({ agent }) {
  const statusColors = {
    active: 'bg-green-500',
    inactive: 'bg-gray-500',
    deprecated: 'bg-red-500',
  };

  return (
    <Link
      to={`/agents/${agent.verusId || agent.id}`}
      className="block card !p-6"
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold text-white">{agent.name}</h3>
            <span className={`w-2 h-2 rounded-full ${statusColors[agent.status] || 'bg-gray-500'}`} />
            <span className="text-xs text-gray-500 capitalize">{agent.status}</span>
          </div>
          <div className="mt-1">
            <ResolvedId address={agent.verusId} name={agent.name} size="sm" />
          </div>
          {agent.description && (
            <p className="text-gray-300 mt-3 line-clamp-2">{agent.description}</p>
          )}
        </div>
        
        <div className="flex flex-col items-end gap-2">
          {agent.reputation?.score && (
            <div className="flex items-center gap-1 bg-yellow-500/10 px-2 py-1 rounded">
              <span className="text-yellow-400">★</span>
              <span className="text-yellow-400 font-medium">
                {agent.reputation.score.toFixed(1)}
              </span>
              <span className="text-gray-500 text-xs">
                ({agent.reputation.totalReviews})
              </span>
            </div>
          )}
          <span className="px-2 py-1 bg-gray-700 text-gray-300 text-xs rounded capitalize">
            {agent.type}
          </span>
          {agent.verified && (
            <span className="text-green-400 text-xs flex items-center gap-1">
              ✓ Verified
            </span>
          )}
        </div>
      </div>

      {agent.capabilities && agent.capabilities.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-4">
          {agent.capabilities.slice(0, 5).map((cap, i) => (
            <span
              key={i}
              className="px-2 py-1 bg-gray-900 text-gray-400 text-xs rounded"
            >
              {cap.name || cap.id}
            </span>
          ))}
          {agent.capabilities.length > 5 && (
            <span className="text-xs text-gray-500">
              +{agent.capabilities.length - 5} more
            </span>
          )}
        </div>
      )}
    </Link>
  );
}
