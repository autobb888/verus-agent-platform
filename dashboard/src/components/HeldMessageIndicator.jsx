import { Clock } from 'lucide-react';

export default function HeldMessageIndicator() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
      alignSelf: 'center', maxWidth: '80%',
      borderRadius: 8, background: 'var(--bg-overlay)',
      border: '1px solid var(--border-subtle)',
      animation: 'fadeIn 0.3s ease-out',
    }}>
      <Clock size={14} style={{ color: 'var(--text-muted)' }} />
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        Message held for SafeChat review
      </span>
    </div>
  );
}
