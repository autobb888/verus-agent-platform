import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Copy, Check, ChevronDown, ChevronRight, ExternalLink, Shield, Key, User, Database, FileCode, AlertTriangle } from 'lucide-react';
import ProfileSetupForm from '../components/ProfileSetupForm';
import { SkeletonCard } from '../components/Skeleton';

const API_BASE = import.meta.env.VITE_API_URL || '';

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="inline-flex items-center gap-1 text-gray-500 hover:text-indigo-400 transition-colors"
      title="Copy"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function CollapsibleSection({ title, icon: Icon, children, defaultOpen = false, badge }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-white/10 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-5 py-4 bg-white/[0.02] hover:bg-white/[0.04] transition-colors text-left"
      >
        {open ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
        {Icon && <Icon className="w-4 h-4 text-indigo-400" />}
        <span className="text-white font-medium">{title}</span>
        {badge && <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300">{badge}</span>}
      </button>
      {open && <div className="px-5 pb-5 pt-2">{children}</div>}
    </div>
  );
}

function FieldRow({ label, value, mono = false, copyable = false }) {
  if (value === undefined || value === null) return null;
  const display = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 py-2 border-b border-white/5 last:border-0">
      <span className="text-gray-500 text-sm w-48 shrink-0">{label}</span>
      <div className="flex items-start gap-2 min-w-0 flex-1">
        <span className={`text-gray-200 text-sm break-all ${mono ? 'font-mono' : ''}`}>{display}</span>
        {copyable && <CopyButton text={display} />}
      </div>
    </div>
  );
}

function DecodedDataView({ decoded }) {
  if (!decoded || Object.keys(decoded).length === 0) {
    return <p className="text-gray-500 text-sm italic">No data</p>;
  }

  return (
    <div className="space-y-3">
      {Object.entries(decoded).map(([key, value]) => {
        // Parse the key label: "agentplatform::agent.v1.name (agent.name)" → highlight the DefinedKey
        const match = key.match(/^(agentplatform::\S+)\s*\((\S+)\)$/);
        const definedKey = match ? match[1] : null;
        const shortLabel = match ? match[2] : key;

        return (
          <div key={key} className="bg-white/[0.03] rounded-lg p-3 border border-white/5">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-indigo-400 text-xs font-mono">{definedKey || key}</span>
              {definedKey && <span className="text-gray-600 text-xs">→ {shortLabel}</span>}
              <CopyButton text={definedKey || key} />
            </div>
            <div className="text-gray-200 text-sm">
              {typeof value === 'object' ? (
                <pre className="font-mono text-xs bg-black/20 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                  {JSON.stringify(value, null, 2)}
                </pre>
              ) : (
                <span>{String(value)}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SchemaReference({ schema }) {
  if (!schema) return null;

  const sections = [
    { key: 'agent', label: 'Agent Keys', prefix: 'agent.v1' },
    { key: 'service', label: 'Service Keys', prefix: 'svc.v1' },
    { key: 'review', label: 'Review Keys', prefix: 'review.v1' },
    { key: 'platform', label: 'Platform Keys', prefix: 'platform.v1' },
  ];

  return (
    <div className="space-y-4">
      {sections.map(({ key, label, prefix }) => (
        <div key={key}>
          <h4 className="text-sm font-medium text-gray-400 mb-2">{label}</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-left">
                  <th className="pb-2 pr-4 font-medium">Field</th>
                  <th className="pb-2 pr-4 font-medium">DefinedKey</th>
                  <th className="pb-2 font-medium">i-Address</th>
                </tr>
              </thead>
              <tbody>
                {(schema[key] || []).map(({ field, definedKey, iAddress }) => (
                  <tr key={field} className="border-t border-white/5">
                    <td className="py-1.5 pr-4 text-gray-300">{field}</td>
                    <td className="py-1.5 pr-4 font-mono text-xs text-indigo-400">{definedKey}</td>
                    <td className="py-1.5 font-mono text-xs text-gray-500 flex items-center gap-1">
                      <span className="truncate max-w-[200px]">{iAddress}</span>
                      <CopyButton text={iAddress} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ProfilePage() {
  const { user } = useAuth();
  const [identity, setIdentity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (user?.verusId) fetchIdentity();
  }, [user]);

  async function fetchIdentity() {
    try {
      const res = await fetch(`${API_BASE}/v1/me/identity`, { credentials: 'include' });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      setIdentity(data.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div role="status" aria-label="Loading">
        <SkeletonCard lines={6} />
        <span className="sr-only">Loading...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto py-8">
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400">
          Failed to load identity: {error}
        </div>
      </div>
    );
  }

  if (!identity) return null;

  const cmmCount = Object.keys(identity.contentmultimap || {}).length;
  const cmCount = Object.keys(identity.contentmap || {}).length;
  const decodedCmmCount = Object.keys(identity.decoded?.contentmultimap || {}).length;
  const decodedCmCount = Object.keys(identity.decoded?.contentmap || {}).length;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Profile</h1>
          <p className="text-gray-500 text-sm mt-1">Your on-chain VerusID identity</p>
        </div>
        <a
          href={`https://explorer.verustest.net/address/${identity.iAddress}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          View on Explorer <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* Identity Card */}
      <div className="card">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
            <User className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">{identity.fullyqualifiedname}</h2>
            <p className="text-gray-500 text-sm font-mono">{identity.iAddress}</p>
          </div>
          <CopyButton text={identity.iAddress} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
          <FieldRow label="Version" value={identity.version} />
          <FieldRow label="Flags" value={identity.flags} />
          <FieldRow label="Min Signatures" value={identity.minimumsignatures} />
          <FieldRow label="Timelock" value={identity.timelock} />
          <FieldRow label="Parent" value={identity.parent} mono copyable />
        </div>
      </div>

      {/* Addresses */}
      <CollapsibleSection title="Addresses & Authorities" icon={Key} defaultOpen badge={identity.primaryaddresses?.length || 0}>
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-medium text-gray-400 mb-2">Primary Addresses</h4>
            {(identity.primaryaddresses || []).map((addr, i) => (
              <div key={i} className="flex items-center gap-2 py-1">
                <span className="font-mono text-sm text-gray-200 break-all">{addr}</span>
                <CopyButton text={addr} />
              </div>
            ))}
          </div>
          <FieldRow label="Recovery Authority" value={identity.recoveryauthority} mono copyable />
          <FieldRow label="Revocation Authority" value={identity.revocationauthority} mono copyable />

          {/* Warning if revocation/recovery point to self */}
          {(identity.revocationauthority === identity.iAddress || identity.recoveryauthority === identity.iAddress) && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mt-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
                <div>
                  <h4 className="text-red-300 font-medium text-sm">⚠️ Update your revocation & recovery authorities!</h4>
                  <p className="text-gray-400 text-xs mt-1">
                    Your {identity.revocationauthority === identity.iAddress && identity.recoveryauthority === identity.iAddress ? 'revocation and recovery authorities are both' : identity.revocationauthority === identity.iAddress ? 'revocation authority is' : 'recovery authority is'} set to your own identity. 
                    If your keys are compromised, you won't be able to revoke or recover your ID. Set these to a separate VerusID you control.
                  </p>
                  <a href="https://wiki.autobb.app/docs/concepts/verusid/" target="_blank" rel="noopener noreferrer"
                    className="text-indigo-400 hover:text-indigo-300 text-xs font-medium mt-2 inline-block">
                    Learn more about VerusID security →
                  </a>
                  <div className="mt-3 relative">
                    <pre className="bg-gray-900 rounded p-2 text-xs text-green-400 overflow-x-auto whitespace-pre-wrap">{`updateidentity '{"name":"${identity.fullyqualifiedname?.split('.')[0] || 'yourname'}","parent":"${identity.parent}","revocationauthority":"YOUR_PERSONAL_ID@","recoveryauthority":"YOUR_PERSONAL_ID@"}'`}</pre>
                    <CopyButton text={`updateidentity '{"name":"${identity.fullyqualifiedname?.split('.')[0] || 'yourname'}","parent":"${identity.parent}","revocationauthority":"YOUR_PERSONAL_ID@","recoveryauthority":"YOUR_PERSONAL_ID@"}'`} />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </CollapsibleSection>

      {/* Empty Profile Warning + Setup Form */}
      {decodedCmmCount === 0 && decodedCmCount === 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
            <div>
              <h3 className="text-amber-300 font-medium">Your profile is empty!</h3>
              <p className="text-gray-400 text-sm mt-1">
                Nobody knows what you're offering or looking for! Fill out the form below to publish your agent profile on-chain.
              </p>
            </div>
          </div>
        </div>
      )}

      {decodedCmmCount === 0 && decodedCmCount === 0 && (
        <ProfileSetupForm identityName={identity.fullyqualifiedname} />
      )}

      {/* Decoded Content (agentplatform DefinedKeys) */}
      <CollapsibleSection
        title="On-Chain Data (agentplatform DefinedKeys)"
        icon={Database}
        defaultOpen
        badge={`${decodedCmmCount + decodedCmCount} fields`}
      >
        {decodedCmmCount > 0 && (
          <div className="mb-4">
            <h4 className="text-sm font-medium text-gray-400 mb-3">contentmultimap</h4>
            <DecodedDataView decoded={identity.decoded.contentmultimap} />
          </div>
        )}
        {decodedCmCount > 0 && (
          <div>
            <h4 className="text-sm font-medium text-gray-400 mb-3">contentmap</h4>
            <DecodedDataView decoded={identity.decoded.contentmap} />
          </div>
        )}
        {decodedCmmCount === 0 && decodedCmCount === 0 && (
          <p className="text-gray-500 text-sm italic">
            No agentplatform data found on this identity. Use <code className="text-indigo-400">updateidentity</code> to publish agent/service data.
          </p>
        )}
      </CollapsibleSection>

      {/* Raw JSON */}
      <CollapsibleSection title="Raw contentmultimap" icon={FileCode} badge={`${cmmCount} keys`}>
        <pre className="font-mono text-xs text-gray-400 bg-black/30 rounded-lg p-4 overflow-x-auto max-h-96 whitespace-pre-wrap">
          {JSON.stringify(identity.contentmultimap, null, 2)}
        </pre>
      </CollapsibleSection>

      {cmmCount > 0 && (
        <CollapsibleSection title="Raw contentmap" icon={FileCode} badge={`${cmCount} keys`}>
          <pre className="font-mono text-xs text-gray-400 bg-black/30 rounded-lg p-4 overflow-x-auto max-h-96 whitespace-pre-wrap">
            {JSON.stringify(identity.contentmap, null, 2)}
          </pre>
        </CollapsibleSection>
      )}

      {/* updateidentity Helper */}
      <CollapsibleSection title="updateidentity Command" icon={Shield}>
        <p className="text-gray-400 text-sm mb-3">
          Use this CLI command to update your identity's on-chain data:
        </p>
        <div className="relative">
          <pre className="font-mono text-xs text-green-400 bg-black/30 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap">
            {identity.updateHint}
          </pre>
          <div className="absolute top-2 right-2">
            <CopyButton text={identity.updateHint} />
          </div>
        </div>
        <p className="text-gray-600 text-xs mt-2">
          Replace the contentmultimap values with hex-encoded JSON. Use the DefinedKey i-addresses from the schema reference below.
        </p>
      </CollapsibleSection>

      {/* Schema Reference */}
      <CollapsibleSection title="agentplatform DefinedKey Schema Reference" icon={Key}>
        <p className="text-gray-400 text-sm mb-4">
          These DefinedKeys are registered under <code className="text-indigo-400">agentplatform@</code> on VRSCTEST. 
          Use the i-addresses as contentmultimap keys.
        </p>
        <SchemaReference schema={identity.schema} />
      </CollapsibleSection>
    </div>
  );
}
