import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

function generateGradient(address) {
  const hash = simpleHash(address);
  const hue1 = hash % 360;
  const hue2 = (hash * 7) % 360;
  return `linear-gradient(135deg, hsl(${hue1}, 70%, 55%), hsl(${hue2}, 70%, 45%))`;
}

function getInitials(name, address) {
  if (name) {
    const clean = name.replace(/@$/, '');
    return clean.slice(0, 2).toUpperCase();
  }
  if (address) {
    return address.slice(1, 3).toUpperCase();
  }
  return '??';
}

function truncateAddress(address) {
  if (!address || address.length <= 12) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

const sizes = {
  sm: { avatar: 24, font: 9, nameSize: 12, addrSize: 10, iconSize: 12 },
  md: { avatar: 32, font: 11, nameSize: 14, addrSize: 12, iconSize: 14 },
  lg: { avatar: 40, font: 13, nameSize: 16, addrSize: 13, iconSize: 16 },
};

export default function VerusIdDisplay({ address, name, size = 'md', showAddress = true, linkTo }) {
  const [copied, setCopied] = useState(false);
  const s = sizes[size] || sizes.md;

  function handleCopy(e) {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const displayName = name ? (name.endsWith('@') ? name : `${name}@`) : null;

  return (
    <div className="verus-id-display" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {/* Avatar */}
      <div
        style={{
          width: s.avatar,
          height: s.avatar,
          minWidth: s.avatar,
          borderRadius: 8,
          background: generateGradient(address || ''),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: s.font,
          fontWeight: 700,
          color: 'white',
          letterSpacing: '0.02em',
        }}
      >
        {getInitials(name, address)}
      </div>

      {/* Info */}
      <div style={{ minWidth: 0, flex: 1 }}>
        {displayName && (
          <div
            style={{
              fontSize: s.nameSize,
              fontWeight: 600,
              color: 'var(--text-primary)',
              lineHeight: 1.3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {displayName}
          </div>
        )}
        {showAddress && address && (
          <div
            style={{
              fontSize: s.addrSize,
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-muted)',
              lineHeight: 1.3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={address}
          >
            {truncateAddress(address)}
          </div>
        )}
      </div>

      {/* Copy button */}
      {address && (
        <button
          onClick={handleCopy}
          className="verus-id-copy-btn"
          title="Copy full address"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 4,
            borderRadius: 4,
            color: copied ? 'var(--status-success)' : 'var(--text-muted)',
            opacity: copied ? 1 : 0,
            transition: 'opacity 0.15s, color 0.15s',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {copied ? <Check size={s.iconSize} /> : <Copy size={s.iconSize} />}
        </button>
      )}

      <style>{`
        .verus-id-display:hover .verus-id-copy-btn {
          opacity: 0.6 !important;
        }
        .verus-id-display .verus-id-copy-btn:hover {
          opacity: 1 !important;
          background: rgba(255,255,255,0.05) !important;
        }
      `}</style>
    </div>
  );
}
