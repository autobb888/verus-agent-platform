import { useState, useEffect } from 'react';
import { AlertTriangle, Info, XCircle, X, Flag, ChevronDown } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';

const SEVERITY_CONFIG = {
  info: { color: '#60a5fa', bg: 'rgba(96,165,250,0.08)', border: 'rgba(96,165,250,0.2)', Icon: Info },
  warning: { color: '#fbbf24', bg: 'rgba(251,191,36,0.08)', border: 'rgba(251,191,36,0.2)', Icon: AlertTriangle },
  critical: { color: '#ef4444', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.2)', Icon: XCircle },
};

export default function AlertBanner({ jobId }) {
  const [alerts, setAlerts] = useState([]);
  const [reportingId, setReportingId] = useState(null);
  const [reportReason, setReportReason] = useState('');
  const [dismissing, setDismissing] = useState(new Set());

  useEffect(() => {
    fetchAlerts();
  }, [jobId]);

  async function fetchAlerts() {
    try {
      const res = await fetch(`${API_BASE}/v1/me/alerts?status=pending`, { credentials: 'include' });
      const data = await res.json();
      if (data.data) {
        const filtered = jobId ? data.data.filter(a => a.jobId === jobId) : data.data;
        setAlerts(filtered);
      }
    } catch { /* ignore */ }
  }

  async function dismiss(id) {
    setDismissing(prev => new Set(prev).add(id));
    try {
      await fetch(`${API_BASE}/v1/alerts/${id}/dismiss`, { method: 'POST', credentials: 'include' });
      setTimeout(() => setAlerts(prev => prev.filter(a => a.id !== id)), 300);
    } catch { /* ignore */ }
  }

  async function report(id) {
    if (!reportReason.trim()) return;
    try {
      await fetch(`${API_BASE}/v1/alerts/${id}/report`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reportReason }),
      });
      setReportingId(null);
      setReportReason('');
      setAlerts(prev => prev.filter(a => a.id !== id));
    } catch { /* ignore */ }
  }

  if (alerts.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {alerts.map(alert => {
        const config = SEVERITY_CONFIG[alert.severity] || SEVERITY_CONFIG.info;
        const { color, bg, border, Icon } = config;
        const isDismissing = dismissing.has(alert.id);

        return (
          <div
            key={alert.id}
            style={{
              padding: '12px 16px', borderRadius: 10, background: bg,
              border: `1px solid ${border}`,
              opacity: isDismissing ? 0 : 1,
              transform: isDismissing ? 'translateY(-8px)' : 'none',
              transition: 'all 0.3s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <Icon size={16} style={{ color, marginTop: 2, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color }}>{alert.title}</div>
                {alert.detail && (
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{alert.detail}</div>
                )}

                {/* Report form */}
                {reportingId === alert.id && (
                  <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                    <input
                      type="text"
                      value={reportReason}
                      onChange={e => setReportReason(e.target.value)}
                      maxLength={500}
                      placeholder="Reason for report..."
                      style={{
                        flex: 1, fontSize: 12, padding: '6px 10px', borderRadius: 6,
                        background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
                        color: 'var(--text-primary)', outline: 'none',
                      }}
                      onKeyDown={e => e.key === 'Enter' && report(alert.id)}
                    />
                    <button onClick={() => report(alert.id)} className="btn-primary" style={{ fontSize: 12, padding: '4px 10px' }}>
                      Submit
                    </button>
                    <button onClick={() => { setReportingId(null); setReportReason(''); }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                      <X size={14} />
                    </button>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                <button
                  onClick={() => setReportingId(alert.id)}
                  title="Report Agent"
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                    color: 'var(--text-muted)', borderRadius: 4, transition: 'color 0.15s',
                  }}
                  onMouseEnter={e => e.target.style.color = color}
                  onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}
                >
                  <Flag size={14} />
                </button>
                <button
                  onClick={() => dismiss(alert.id)}
                  title="Dismiss"
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                    color: 'var(--text-muted)', borderRadius: 4, transition: 'color 0.15s',
                  }}
                  onMouseEnter={e => e.target.style.color = 'var(--text-primary)'}
                  onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
