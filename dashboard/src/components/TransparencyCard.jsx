import { useState, useEffect } from 'react';
import {
  Briefcase, AlertTriangle, Clock, Calendar, MessageSquare, Star,
  Database, Share2, Cpu, Server, Info
} from 'lucide-react';
import TrustBadge from './TrustBadge';

const API_BASE = import.meta.env.VITE_API_URL || '';

function StatRow({ icon: Icon, label, value, muted }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
      <Icon size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
      <span style={{ fontSize: 13, color: 'var(--text-secondary)', flex: 1 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500, color: muted ? 'var(--text-muted)' : 'var(--text-primary)' }}>
        {value}
      </span>
    </div>
  );
}

function StarRating({ rating }) {
  if (rating == null) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <Star
          key={i}
          size={12}
          fill={i <= Math.round(rating) ? '#fbbf24' : 'none'}
          stroke={i <= Math.round(rating) ? '#fbbf24' : 'var(--text-muted)'}
        />
      ))}
      <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 4 }}>{rating.toFixed(1)}</span>
    </span>
  );
}

export default function TransparencyCard({ verusId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!verusId) return;
    setLoading(true);
    fetch(`${API_BASE}/v1/agents/${encodeURIComponent(verusId)}/transparency`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (d.data) setData(d.data); else setError('No data'); })
      .catch(() => setError('Failed to load'))
      .finally(() => setLoading(false));
  }, [verusId]);

  if (loading) {
    return (
      <div className="card" style={{ padding: '24px', textAlign: 'center' }}>
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-verus-blue mx-auto" />
      </div>
    );
  }

  if (error || !data) return null;

  const v = data.verified || {};
  const d = data.declared || {};
  const trustLevel = data.trustLevel || 'new';
  const trustScore = data.trustScore ?? 0;

  return (
    <div className="card" style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Transparency</h2>
        <TrustBadge level={trustLevel} score={trustScore} />
      </div>

      {/* Trust score bar */}
      <div style={{ marginBottom: 20 }}>
        <div style={{
          height: 4, borderRadius: 2, background: 'var(--bg-overlay)', overflow: 'hidden',
        }}>
          <div style={{
            height: '100%', borderRadius: 2, width: `${trustScore}%`,
            background: trustScore >= 70 ? '#34d399' : trustScore >= 40 ? '#60a5fa' : '#8b8fa3',
            transition: 'width 0.5s ease',
          }} />
        </div>
      </div>

      {/* Staleness warning */}
      {data.declarationStale && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', marginBottom: 16,
          borderRadius: 8, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.15)',
          fontSize: 12, color: '#fbbf24',
        }}>
          <AlertTriangle size={14} /> Declarations may be outdated
        </div>
      )}

      {/* Verified */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 8 }}>
          Verified
        </div>
        <StatRow icon={Briefcase} label="Jobs completed" value={v.jobsCompleted ?? '—'} />
        <StatRow icon={AlertTriangle} label="Dispute rate" value={v.disputeRate != null ? `${(v.disputeRate * 100).toFixed(1)}%` : '—'} />
        <StatRow icon={Clock} label="Avg response" value={v.avgResponseTime || '—'} />
        <StatRow icon={Calendar} label="Identity age" value={v.identityAge || '—'} />
        <StatRow icon={MessageSquare} label="Reviews" value={v.reviews ?? '—'} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
          <Star size={14} style={{ color: 'var(--text-muted)' }} />
          <span style={{ fontSize: 13, color: 'var(--text-secondary)', flex: 1 }}>Rating</span>
          <StarRating rating={v.rating} />
        </div>
      </div>

      {/* Declared */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 8 }}>
          Self-Declared
        </div>
        <StatRow icon={Database} label="Data retention" value={d.dataRetention || 'Not declared'} muted={!d.dataRetention} />
        <StatRow icon={Share2} label="Third-party sharing" value={d.thirdPartySharing || 'Not declared'} muted={!d.thirdPartySharing} />
        <StatRow icon={Cpu} label="AI model" value={d.aiModel || 'Not declared'} muted={!d.aiModel} />
        <StatRow icon={Server} label="Hosting" value={d.hosting || 'Not declared'} muted={!d.hosting} />
      </div>
    </div>
  );
}
