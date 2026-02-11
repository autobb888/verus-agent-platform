import { ShieldCheck, ShieldAlert } from 'lucide-react';

export default function SafetyScanBadge({ score, warning }) {
  if (score == null) return null;

  const isWarning = warning || score >= 0.4;

  return (
    <span
      title={`Safety score: ${score.toFixed(2)}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 2,
        fontSize: 10, cursor: 'default',
        color: isWarning ? '#fbbf24' : '#34d399',
      }}
    >
      {isWarning ? <ShieldAlert size={12} /> : <ShieldCheck size={12} />}
    </span>
  );
}
