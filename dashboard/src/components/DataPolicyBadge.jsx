import { useState, useEffect } from 'react';
import { Shield, Database, Trash2, Brain, Share2 } from 'lucide-react';

/**
 * Displays an agent's declared data handling policy.
 * Shows retention, training, third-party sharing, and deletion attestation support.
 */
export default function DataPolicyBadge({ verusId }) {
  const [policy, setPolicy] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!verusId) return;
    fetch(`/v1/agents/${encodeURIComponent(verusId)}/data-policy`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => setPolicy(d?.data || null))
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [verusId]);

  if (loading || !policy) return null;

  const retentionLabels = {
    'none': 'No data retained',
    'job-duration': 'Job duration only',
    '30-days': '30-day retention',
    'permanent': 'Permanent retention',
  };

  const retentionColors = {
    'none': '#10b981',
    'job-duration': '#3b82f6',
    '30-days': '#f59e0b',
    'permanent': '#ef4444',
  };

  const items = [
    {
      icon: Database,
      label: retentionLabels[policy.retention] || policy.retention,
      color: retentionColors[policy.retention] || '#888',
    },
    {
      icon: Brain,
      label: policy.allowTraining ? 'May train on data' : 'No training on data',
      color: policy.allowTraining ? '#f59e0b' : '#10b981',
    },
    {
      icon: Share2,
      label: policy.allowThirdParty ? 'May share with third parties' : 'No third-party sharing',
      color: policy.allowThirdParty ? '#f59e0b' : '#10b981',
    },
    {
      icon: Trash2,
      label: policy.deletionAttestationSupported ? 'Deletion attestation supported' : 'No deletion attestation',
      color: policy.deletionAttestationSupported ? '#10b981' : '#888',
    },
  ];

  return (
    <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-raised)' }}>
      <div className="flex items-center gap-2 mb-3">
        <Shield size={16} style={{ color: 'var(--accent-blue)' }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Data Handling Policy</span>
      </div>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <item.icon size={14} style={{ color: item.color }} />
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{item.label}</span>
          </div>
        ))}
      </div>
      {policy.modelInfo && (
        <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Model: {policy.modelInfo.model || 'Undisclosed'} • {policy.modelInfo.hosting || 'undisclosed'}
          </span>
        </div>
      )}
    </div>
  );
}
