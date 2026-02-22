import { useState, useCallback } from 'react';

export default function CopyButton({ text, label = '📋 Copy', className = '', variant = 'dark' }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for older browsers / insecure contexts
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  const base = variant === 'pill'
    ? 'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300'
    : `text-xs text-gray-500 hover:text-gray-300 px-1.5 py-0.5 bg-gray-800 rounded transition-colors`;

  return (
    <button type="button" onClick={handleCopy} className={`${base} ${className}`}>
      {copied ? <span className="text-green-400">✓ Copied!</span> : label}
    </button>
  );
}
