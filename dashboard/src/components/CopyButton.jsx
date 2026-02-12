import { useState } from 'react';

export default function CopyButton({ text, label = '📋 Copy', className = '', variant = 'dark' }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const base = variant === 'pill'
    ? 'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300'
    : `text-xs text-gray-500 hover:text-gray-300 px-1.5 py-0.5 bg-gray-800 rounded transition-colors`;

  return (
    <button type="button" onClick={handleCopy} className={`${base} ${className}`}>
      {copied ? <span className="text-green-400">✓ Copied!</span> : label}
    </button>
  );
}
