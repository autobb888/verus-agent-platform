import { useState, useMemo, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import TimePicker from './TimePicker';
import CopyButton from './CopyButton';

const API_BASE = import.meta.env.VITE_API_URL || '';

// Compute default deadline: today's date and current time + 1 hour (rounded to nearest 5 min)
function getDefaultDeadline() {
  const now = new Date();
  now.setHours(now.getHours() + 1);
  // Round minutes to nearest 5
  const mins = Math.ceil(now.getMinutes() / 5) * 5;
  now.setMinutes(mins, 0, 0);
  const date = now.toISOString().split('T')[0];
  const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  return { date, time };
}

export default function HireModal({ service, agent, onClose, onSuccess }) {
  const { user } = useAuth();
  const defaultDeadline = useMemo(() => getDefaultDeadline(), []);
  const [description, setDescription] = useState(service?.description || '');
  const [deadlineDate, setDeadlineDate] = useState(defaultDeadline.date);
  const [deadlineTime, setDeadlineTime] = useState(defaultDeadline.time);
  const [message, setMessage] = useState('');
  const [signature, setSignature] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [timestamp, setTimestamp] = useState(Math.floor(Date.now() / 1000));
  const [dataRetention, setDataRetention] = useState('none');
  const [allowTraining, setAllowTraining] = useState(false);
  const [allowThirdParty, setAllowThirdParty] = useState(false);
  const [requireDeletion, setRequireDeletion] = useState(true);
  const [privateMode, setPrivateMode] = useState(false); // E2E encrypted premium
  const [safechatEnabled, setSafechatEnabled] = useState(true);

  // Lock body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

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
  // Use explicit verusId resolution to avoid signing payloads with To:undefined.
  const sellerVerusId =
    service?.verusId ||
    service?.agentVerusId ||
    service?.sellerVerusId ||
    agent?.verusId ||
    agent?.id;
  const amount = Number(service?.price) || 0;
  const currency = service?.currency || 'VRSCTEST';
  // Data sharing discounts — sharing data = cheaper job
  const dataDiscount = (allowTraining ? 0.10 : 0) + (allowThirdParty ? 0.10 : 0) + (!requireDeletion ? 0.05 : 0);
  const privatePremium = privateMode ? amount * 0.50 : 0;
  const baseFeeRate = 0.05; // 5% platform fee
  const discountedFeeRate = Math.max(baseFeeRate * (1 - dataDiscount), 0);
  const adjustedAmount = amount + privatePremium;
  const feeAmount = (adjustedAmount * discountedFeeRate).toFixed(4);
  const totalCost = (adjustedAmount + adjustedAmount * discountedFeeRate).toFixed(4);
  const savingsPercent = Math.round(dataDiscount * 100);
  const signMessage = `VAP-JOB|To:${sellerVerusId}|Desc:${description}|Amt:${amount} ${currency}|Fee:${feeAmount} ${currency}|SafeChat:${safechatEnabled ? 'yes' : 'no'}|Deadline:${deadline || 'None'}|Ts:${timestamp}|I request this job and agree to pay upon completion.`;

  async function handleSubmit(e) {
    e.preventDefault();

    if (!sellerVerusId) {
      setError('Seller identity is missing. Please refresh and reopen this service.');
      return;
    }

    if (!description.trim()) {
      setError('Job description is required.');
      return;
    }

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
          sellerVerusId,
          serviceId: service?.id,
          description: description.trim(),
          message: message.trim() || undefined,
          amount: service?.price || 0,
          currency: service?.currency || 'VRSCTEST',
          deadline: deadline || undefined,
          paymentTerms: 'prepay',
          safechatEnabled,
          dataTerms: {
            retention: dataRetention,
            allowTraining,
            allowThirdParty,
            requireDeletionAttestation: requireDeletion,
          },
          fee: parseFloat(feeAmount),
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
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={onClose}>
      <div className="bg-gray-800 rounded-t-xl sm:rounded-xl max-w-2xl w-full max-h-[95vh] sm:max-h-[90vh] overflow-y-auto overscroll-contain" onClick={e => e.stopPropagation()}>
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
                maxLength={2000}
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
                    min={new Date().toISOString().split('T')[0]}
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
                maxLength={1000}
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
                <option value="none">Agent must delete all data after job (default)</option>
                <option value="job-duration">Agent retains during job only</option>
                <option value="30-days">Agent may retain for 30 days</option>
                <option value="indefinite">Agent may retain indefinitely</option>
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={allowTraining} onChange={e => setAllowTraining(e.target.checked)}
                  className="rounded border-gray-600 bg-gray-800 text-verus-blue focus:ring-verus-blue" />
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Allow the agent to train on my data</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={allowThirdParty} onChange={e => setAllowThirdParty(e.target.checked)}
                  className="rounded border-gray-600 bg-gray-800 text-verus-blue focus:ring-verus-blue" />
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Allow the agent to share my data with third parties</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={requireDeletion} onChange={e => setRequireDeletion(e.target.checked)}
                  className="rounded border-gray-600 bg-gray-800 text-verus-blue focus:ring-verus-blue" />
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Require signed deletion attestation from agent after completion</span>
              </label>
            </div>

            {/* Private Mode — E2E Premium */}
            <div className="border-t pt-3 mt-2" style={{ borderColor: 'var(--border-subtle)' }}>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={privateMode} onChange={e => {
                  setPrivateMode(e.target.checked);
                  if (e.target.checked) {
                    setAllowTraining(false);
                    setAllowThirdParty(false);
                    setRequireDeletion(true);
                    setDataRetention('none');
                  }
                }}
                  className="rounded border-gray-600 bg-gray-800 text-verus-blue focus:ring-verus-blue mt-0.5" />
                <div>
                  <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>🔐 Private Mode — End-to-End Encrypted</span>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                    Messages encrypted end-to-end. Neither the platform nor any third party can read your conversation. <span className="text-amber-400 font-medium">+50% premium</span>
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* SafeChat Protection */}
          <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-raised)' }}>
            <h4 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>🛡️ SafeChat Protection</h4>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={safechatEnabled} onChange={e => setSafechatEnabled(e.target.checked)}
                className="rounded border-gray-600 bg-gray-800 text-verus-blue focus:ring-verus-blue" />
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Enable SafeChat — 6-layer prompt injection protection for both parties</span>
            </label>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>SafeChat scans all messages for manipulation, protecting you and the agent.</p>
          </div>

          {/* Payment Breakdown */}
          <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-raised)' }}>
            <h4 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>💰 Payment Breakdown</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-secondary)' }}>Agent Payment</span>
                <span style={{ color: 'var(--text-primary)' }}>{amount} {currency}</span>
              </div>
              {privateMode && (
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-secondary)' }}>🔐 Private Mode Premium (+50%)</span>
                  <span className="text-amber-400">{privatePremium.toFixed(4)} {currency}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-secondary)' }}>
                  Platform Fee ({(discountedFeeRate * 100).toFixed(1)}%)
                  {savingsPercent > 0 && <span className="text-green-400 ml-1">(-{savingsPercent}% data sharing discount)</span>}
                </span>
                <span style={{ color: 'var(--text-primary)' }}>{feeAmount} {currency}</span>
              </div>
              <div className="border-t pt-2 mt-2 flex justify-between font-semibold" style={{ borderColor: 'var(--border-subtle)' }}>
                <span style={{ color: 'var(--text-primary)' }}>Total</span>
                <span className="text-verus-blue">{totalCost} {currency}</span>
              </div>
            </div>
            <p className="text-xs mt-3" style={{ color: 'var(--text-tertiary)' }}>
              You'll send two transactions after the agent accepts: one to the agent ({privateMode ? adjustedAmount.toFixed(4) : amount} {currency}) and one platform fee ({feeAmount} {currency}).
            </p>
          </div>

          {/* Signature section */}
          <div className="bg-gray-900 rounded-lg p-4 space-y-4">
            <h3 className="text-white font-medium">Sign Your Request</h3>
            <p className="text-gray-400 text-sm">
              Copy the message below and sign it with your VerusID to create a binding job request.
            </p>

            {/* Timestamp freshness indicator */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">
                Timestamp: {new Date(timestamp * 1000).toLocaleTimeString()}
              </span>
              <button
                type="button"
                onClick={() => setTimestamp(Math.floor(Date.now() / 1000))}
                className="text-xs text-verus-blue hover:text-blue-400"
              >
                Refresh
              </button>
            </div>

            <div className="bg-gray-950 rounded p-3">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs text-gray-500">Message to sign:</span>
                <CopyButton text={signMessage} label="Copy" />
              </div>
              <div className="font-mono text-xs text-gray-300 whitespace-pre-wrap">
                {signMessage}
              </div>
            </div>

            {!sellerVerusId && (
              <div className="bg-red-900/40 border border-red-700 rounded p-2 text-xs text-red-300">
                Seller identity is unresolved (To:undefined). Reload the page and reopen this service before signing.
              </div>
            )}

            <div className="bg-gray-950 rounded p-3">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs text-gray-500">Run this command (CLI or GUI console):</span>
                <CopyButton text={`signmessage "${user?.identityName ? `${user.identityName}@` : 'yourID@'}" "${signMessage.replace(/"/g, '\\"')}"`} label="Copy" />
              </div>
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
              disabled={loading || !signature.trim() || !sellerVerusId || !description.trim()}
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
