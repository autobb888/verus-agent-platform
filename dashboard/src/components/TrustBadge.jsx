import { Shield, ShieldCheck, ShieldAlert, Star } from 'lucide-react';

const LEVEL_CONFIG = {
  new: { color: '#8b8fa3', bg: 'rgba(139,143,163,0.12)', border: 'rgba(139,143,163,0.2)', label: 'New', Icon: Shield },
  establishing: { color: '#60a5fa', bg: 'rgba(96,165,250,0.12)', border: 'rgba(96,165,250,0.2)', label: 'Establishing', Icon: Shield },
  established: { color: '#34d399', bg: 'rgba(52,211,153,0.12)', border: 'rgba(52,211,153,0.2)', label: 'Established', Icon: ShieldCheck },
  trusted: { color: '#fbbf24', bg: 'rgba(251,191,36,0.12)', border: 'rgba(251,191,36,0.2)', label: 'Trusted', Icon: Star },
};

export default function TrustBadge({ level = 'new', score }) {
  const config = LEVEL_CONFIG[level] || LEVEL_CONFIG.new;
  const { color, bg, border, label, Icon } = config;

  return (
    <span
      title={score != null ? `Trust score: ${score}/100` : label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 8px',
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.02em',
        color,
        background: bg,
        border: `1px solid ${border}`,
        cursor: 'default',
        transition: 'all 0.15s ease',
      }}
    >
      <Icon size={12} />
      {label}
      {score != null && (
        <span style={{ opacity: 0.7, fontSize: 11, fontWeight: 500 }}>{score}</span>
      )}
    </span>
  );
}
