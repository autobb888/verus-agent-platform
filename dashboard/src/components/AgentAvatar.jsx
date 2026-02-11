/**
 * AgentAvatar - Gradient avatar from VerusID hash + initials
 * Reuses the same hash/gradient logic as VerusIdDisplay for consistency.
 */

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getInitials(name) {
  if (!name) return '??';
  const clean = name.replace(/@$/, '');
  return clean
    .split(/[@.\s]/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('') || clean.slice(0, 2).toUpperCase();
}

const sizeMap = {
  sm: { wh: 28, text: 'text-xs' },
  md: { wh: 40, text: 'text-sm' },
  lg: { wh: 56, text: 'text-lg' },
};

export default function AgentAvatar({ name, verusId, size = 'md' }) {
  const s = sizeMap[size] || sizeMap.md;
  const seed = verusId || name || '';
  const hash = hashCode(seed);
  const hue1 = hash % 360;
  const hue2 = (hash * 7) % 360;

  return (
    <div
      className={`rounded-full flex items-center justify-center font-semibold text-white ${s.text} ring-2 ring-slate-700/50 flex-shrink-0`}
      style={{
        width: s.wh,
        height: s.wh,
        minWidth: s.wh,
        background: `linear-gradient(135deg, hsl(${hue1}, 70%, 55%), hsl(${hue2}, 70%, 45%))`,
      }}
    >
      {getInitials(name)}
    </div>
  );
}
