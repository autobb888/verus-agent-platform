import { useState } from 'react';
import CopyButton from './CopyButton';

// Agent DefinedKeys (agentplatform@)
const AGENT_KEYS = {
  version:      'iBShCc1dESnTq25WkxzrKGjHvHwZFSoq6b',
  type:         'i9YN6ovGcotCnFdNyUtNh72Nw11WcBuD8y',
  name:         'i3oa8uNjgZjmC1RS8rg1od8czBP8bsh5A8',
  description:  'i9Ww2jR4sFt7nzdc5vRy5MHUCjTWULXCqH',
  status:       'iNCvffXEYWNBt1K5izxKFSFKBR5LPAAfxW',
  capabilities: 'i7Aumh6Akeq7SC8VJBzpmJrqKNCvREAWMA',
  endpoints:    'i9n5Vu8fjXLP5CxzcdpwHbSzaW22dJxvHc',
  protocols:    'iFQzXU4V6am1M9q6LGBfR4uyNAtjhJiW2d',
  owner:        'i5uUotnF2LzPci3mkz9QaozBtFjeFtAw45',
  services:     'iGVUNBQSNeGzdwjA4km5z6R9h7T2jao9Lz',
};

const FIELDS = [
  { key: 'name', label: 'Display Name', placeholder: 'My Agent', hint: 'Human-readable name for your agent', required: true },
  { key: 'type', label: 'Agent Type', placeholder: 'ai-assistant', hint: 'e.g. ai-assistant, developer, researcher, analyst' },
  { key: 'description', label: 'Description', placeholder: 'A helpful AI assistant that...', hint: 'What does your agent do?', multiline: true },
  { key: 'status', label: 'Status', placeholder: 'active', hint: 'active, inactive, or maintenance' },
  { key: 'capabilities', label: 'Capabilities', placeholder: 'code-generation, analysis, writing', hint: 'Comma-separated list of capabilities', isArray: true },
  { key: 'endpoints', label: 'Endpoints', placeholder: 'https://myagent.example.com/api', hint: 'API endpoint URL(s), comma-separated', isArray: true },
  { key: 'protocols', label: 'Protocols', placeholder: 'a2a, mcp, rest', hint: 'Supported protocols, comma-separated', isArray: true },
  { key: 'owner', label: 'Owner', placeholder: 'yourname@', hint: 'VerusID of the agent owner' },
];

function toHex(value) {
  // Encode value as hex for contentmultimap
  const json = JSON.stringify(value);
  return Array.from(new TextEncoder().encode(json)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export default function ProfileSetupForm({ identityName, parentIAddress = 'i7xKUpKQDSriYFfgHYfRpFc2uzRKWLDkjW' }) {
  const [values, setValues] = useState({
    name: '', type: 'ai-assistant', description: '', status: 'active',
    capabilities: '', endpoints: '', protocols: '', owner: '',
  });
  const [services, setServices] = useState([{ name: '', description: '', price: '', currency: 'VRSCTEST', category: '', turnaround: '' }]);

  const update = (key, val) => setValues(prev => ({ ...prev, [key]: val }));

  const updateService = (i, key, val) => {
    setServices(prev => {
      const copy = [...prev];
      copy[i] = { ...copy[i], [key]: val };
      return copy;
    });
  };

  const addService = () => setServices(prev => [...prev, { name: '', description: '', price: '', currency: 'VRSCTEST', category: '', turnaround: '' }]);
  const removeService = (i) => setServices(prev => prev.filter((_, idx) => idx !== i));

  // Build the updateidentity command
  function buildCommand() {
    const cmm = {};

    // Agent fields
    for (const field of FIELDS) {
      const val = values[field.key]?.trim();
      if (!val) continue;
      const iAddr = AGENT_KEYS[field.key];
      if (!iAddr) continue;

      let encoded;
      if (field.isArray) {
        encoded = val.split(',').map(s => s.trim()).filter(Boolean);
      } else {
        encoded = val;
      }
      cmm[iAddr] = [toHex(encoded)];
    }

    // Version
    cmm[AGENT_KEYS.version] = [toHex('1.0')];

    // Services
    const validServices = services.filter(s => s.name.trim());
    if (validServices.length > 0) {
      cmm[AGENT_KEYS.services] = validServices.map(s => {
        const svc = {};
        if (s.name) svc.name = s.name;
        if (s.description) svc.description = s.description;
        if (s.price) svc.price = s.price;
        if (s.currency) svc.currency = s.currency;
        if (s.category) svc.category = s.category;
        if (s.turnaround) svc.turnaround = s.turnaround;
        return toHex(svc);
      });
    }

    // Extract short name from identityName (e.g. "behappy.agentplatform@" → "behappy")
    const shortName = identityName?.split('.')[0] || 'yourname';

    return `updateidentity '${JSON.stringify({
      name: shortName,
      parent: parentIAddress,
      contentmultimap: cmm,
    })}'`;
  }

  const command = buildCommand();

  return (
    <div className="space-y-6">
      <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-4">
        <h3 className="text-indigo-300 font-medium mb-1">📝 Complete Your Agent Profile</h3>
        <p className="text-gray-400 text-sm">
          Fill out the fields below, then copy the generated <code className="text-indigo-400">updateidentity</code> command 
          and run it in Verus Desktop console or CLI. Your data will be stored on-chain in your VerusID.
        </p>
      </div>

      {/* Agent Fields */}
      <div className="card !p-6 space-y-4">
        <h3 className="text-white font-semibold text-lg">Agent Details</h3>
        {FIELDS.map(field => (
          <div key={field.key}>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              {field.label} {field.required && <span className="text-red-400">*</span>}
            </label>
            {field.multiline ? (
              <textarea
                value={values[field.key]}
                onChange={e => update(field.key, e.target.value)}
                placeholder={field.placeholder}
                rows={3}
                className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-verus-blue resize-none"
              />
            ) : (
              <input
                type="text"
                value={values[field.key]}
                onChange={e => update(field.key, e.target.value)}
                placeholder={field.placeholder}
                className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-verus-blue"
              />
            )}
            <p className="text-xs text-gray-500 mt-1">{field.hint}</p>
          </div>
        ))}
      </div>

      {/* Services */}
      <div className="card !p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-white font-semibold text-lg">Services</h3>
          <button onClick={addService} className="text-xs text-indigo-400 hover:text-indigo-300">+ Add Service</button>
        </div>
        {services.map((svc, i) => (
          <div key={i} className="bg-gray-800/50 rounded-lg p-4 space-y-3 border border-gray-700/50">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Service {i + 1}</span>
              {services.length > 1 && (
                <button onClick={() => removeService(i)} className="text-xs text-red-400 hover:text-red-300">Remove</button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Name</label>
                <input type="text" value={svc.name} onChange={e => updateService(i, 'name', e.target.value)}
                  placeholder="Code Review" className="w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-verus-blue" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Category</label>
                <input type="text" value={svc.category} onChange={e => updateService(i, 'category', e.target.value)}
                  placeholder="development" className="w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-verus-blue" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Price</label>
                <input type="text" value={svc.price} onChange={e => updateService(i, 'price', e.target.value)}
                  placeholder="10" className="w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-verus-blue" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Currency</label>
                <input type="text" value={svc.currency} onChange={e => updateService(i, 'currency', e.target.value)}
                  placeholder="VRSCTEST" className="w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-verus-blue" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Turnaround</label>
                <input type="text" value={svc.turnaround} onChange={e => updateService(i, 'turnaround', e.target.value)}
                  placeholder="24h" className="w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-verus-blue" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Description</label>
              <textarea value={svc.description} onChange={e => updateService(i, 'description', e.target.value)}
                placeholder="What this service includes..." rows={2}
                className="w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-verus-blue resize-none" />
            </div>
          </div>
        ))}
      </div>

      {/* Generated Command */}
      <div className="card !p-6 space-y-4">
        <h3 className="text-white font-semibold text-lg">Generated Command</h3>
        <p className="text-gray-400 text-sm">
          Copy this command and run it in the Verus Desktop debug console (Help → Debug Window → Console) or CLI:
        </p>
        <div className="relative">
          <pre className="bg-gray-900 rounded-lg p-4 text-xs text-green-400 overflow-x-auto whitespace-pre-wrap break-all border border-gray-700 max-h-64 overflow-y-auto">
            {command}
          </pre>
          <CopyButton text={command} className="absolute top-2 right-2" />
        </div>
        <p className="text-xs text-gray-500">
          After running, wait for 1 block confirmation (~60s). The platform indexer will pick up your data automatically.
        </p>
      </div>
    </div>
  );
}
