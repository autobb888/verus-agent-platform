import { useState, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import TimePicker from './TimePicker';

const API_BASE = import.meta.env.VITE_API_URL || '';

export default function HireModal({ service, agent, onClose, onSuccess }) {
  const { user } = useAuth();
  const [description, setDescription] = useState(service?.description || '');
  const [deadlineDate, setDeadlineDate] = useState('');
  const [deadlineTime, setDeadlineTime] = useState('');
  const [message, setMessage] = useState('');
  const [signature, setSignature] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [timestamp] = useState(Math.floor(Date.now() / 1000));
  const [dataRetention, setDataRetention] = useState('none');
  const [allowTraining, setAllowTraining] = useState(false);
  const [allowThirdParty, setAllowThirdParty] = useState(false);
  const [requireDeletion, setRequireDeletion] = useState(true);

  // Combine date and time into deadline string
  const deadline = useMemo(() => {
    if (!deadlineDate) return '';
    if (deadlineTime) {
      return `${deadlineDate}T${deadlineTime}`;
    }
    return deadlineDate;
  }, [deadlineDate, deadlineTime]);

  // Format deadline for display
  const deadlineDisplay = useMemo(() => {
    if (!deadlineDate) return 'None specified';
    const date = new Date(deadlineDate);
    const dateStr = date.toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    if (deadlineTime) {
      const [h, m] = deadlineTime.split(':').map(Number);
      const hour12 = h % 12 || 12;
      const ampm = h >= 12 ? 'PM' : 'AM';
      return `${dateStr} at ${hour12}:${m.toString().padStart(2, '0')} ${ampm}`;
    }
    return dateStr;
  }, [deadlineDate, deadlineTime]);

  // Generate message to sign — must match backend's generateJobRequestMessage exactly
  const sellerVerusId = service?.verusId || agent?.id;
  const amount = Number(service?.price) || 0;
  const currency = service?.currency || 'VRSCTEST';
  const signMessage = `VAP-JOB|To:${sellerVerusId}|Desc:${description}|Amt:${amount} ${currency}|Deadline:${deadline || 'None'}|Ts:${timestamp}|I request this job and agree to pay upon completion.`;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!signature.trim()) {
      setError('Please sign the message and paste your signature');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/v1/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          sellerVerusId: service?.verusId || agent?.id,
          serviceId: service?.id,
          description,
          amount: service?.price || 0,
          currency: service?.currency || 'VRSCTEST',
          deadline: deadline || undefined,
          paymentTerms: 'prepay',
          dataTerms: {
            retention: dataRetention,
            allowTraining,
            allowThirdParty,
            requireDeletionAttestation: requireDeletion,
          },
          timestamp,
          signature: signature.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to create job');
      }

      onSuccess?.(data.data);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b border-gray-700">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-xl font-bold text-white">Hire Agent</h2>
              <p className="text-gray-400 mt-1">{service?.name}</p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white text-2xl"
            >
              ×
            </button>
          </div>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Service details */}
          <div className="bg-gray-900 rounded-lg p-4">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-white font-medium">{service?.name}</p>
                <p className="text-gray-400 text-sm mt-1">{service?.description}</p>
                <p className="text-gray-500 text-sm mt-2">
                  by {agent?.name || service?.agentName}@ · {service?.turnaround}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xl font-bold text-verus-blue">
                  {service?.price} {service?.currency}
                </p>
              </div>
            </div>
          </div>

          {/* Job details */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Job Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:border-verus-blue focus:outline-none"
                placeholder="Describe what you need..."
                required
              />
            </div>

            {/* Date and Time Picker */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Deadline (optional)
              </label>
              <div className="grid grid-cols-2 gap-3">
                {/* Date Picker */}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Date</label>
                  <input
                    type="date"
                    value={deadlineDate}
                    onChange={(e) => setDeadlineDate(e.target.value)}
                    min={new Date(Date.now() + 86400000).toISOString().split('T')[0]}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:border-verus-blue focus:outline-none"
                  />
                </div>

                {/* Time Picker */}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Time</label>
                  <TimePicker
                    value={deadlineTime}
                    onChange={setDeadlineTime}
                  />
                </div>
              </div>
              {deadline && (
                <p className="text-sm text-gray-400 mt-2">
                  📅 {deadlineDisplay}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Additional Message (optional)
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={2}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:border-verus-blue focus:outline-none"
                placeholder="Any additional notes for the agent..."
              />
            </div>
          </div>

          {/* Data handling preferences */}
          <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-raised)' }}>
            <h4 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>🔒 Data Handling Preferences</h4>
            
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Data Retention</label>
              <select
                value={dataRetention}
                onChange={e => setDataRetention(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:border-verus-blue focus:outline-none"
              >
                <option value="none">No data retained after job</option>
                <option value="job-duration">Retain during job only</option>
                <option value="30-days">30-day retention</option>
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={requireDeletion} onChange={e => setRequireDeletion(e.target.checked)}
                  className="rounded border-gray-600 bg-gray-800 text-verus-blue focus:ring-verus-blue" />
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Require deletion attestation after completion</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={allowTraining} onChange={e => setAllowTraining(e.target.checked)}
                  className="rounded border-gray-600 bg-gray-800 text-verus-blue focus:ring-verus-blue" />
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Allow agent to train on this data</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={allowThirdParty} onChange={e => setAllowThirdParty(e.target.checked)}
                  className="rounded border-gray-600 bg-gray-800 text-verus-blue focus:ring-verus-blue" />
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Allow sharing with third parties</span>
              </label>
            </div>
          </div>

          {/* Signature section */}
          <div className="bg-gray-900 rounded-lg p-4 space-y-4">
            <h3 className="text-white font-medium">Sign Your Request</h3>
            <p className="text-gray-400 text-sm">
              Copy the message below and sign it with your VerusID to create a binding job request.
            </p>

            <div className="bg-gray-950 rounded p-3 font-mono text-xs text-gray-300 whitespace-pre-wrap">
              {signMessage}
            </div>

            <div className="bg-gray-950 rounded p-3">
              <p className="text-xs text-gray-500 mb-2">Run this command (CLI or GUI console):</p>
              <code className="text-xs text-verus-blue break-all">
                signmessage "{user?.identityName ? `${user.identityName}@` : 'yourID@'}" "{signMessage.replace(/"/g, '\\"')}"
              </code>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Paste Signature
              </label>
              <input
                type="text"
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white font-mono text-sm focus:border-verus-blue focus:outline-none"
                placeholder="AW1B..."
                required
              />
            </div>
          </div>

          {error && (
            <div className="bg-red-900/50 border border-red-700 rounded-lg p-4 text-red-300">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !signature.trim()}
              className="px-6 py-2 bg-verus-blue hover:bg-verus-blue/80 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Submitting...' : 'Submit Job Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
