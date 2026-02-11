import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

const API_BASE = import.meta.env.VITE_API_URL || '';

/**
 * Build a signmessage command — single-line format, works in CLI and GUI console.
 */
function buildSignCmd(idName, message) {
  return `signmessage "${idName}" "${message.replace(/"/g, '\\"')}"`;
}

/**
 * Reusable job action panels (accept, pay, deliver, complete, dispute, cancel).
 * Used by both JobsPage (card expand) and JobDetailPage.
 */

function DeliveryPanel({ job, user, loading, onSubmit, onCancel }) {
  const [deliveryMsg, setDeliveryMsg] = useState('');
  const [sig, setSig] = useState('');

  const ts = Math.floor(Date.now() / 1000);
  const deliveryHash = 'pending'; // Will be computed by backend
  const msg = `VAP-DELIVER|Job:${job.jobHash}|Delivery:${deliveryHash}|Ts:${ts}|I have delivered the work for this job.`;
  const idName = user?.identityName ? `${user.identityName}@` : 'yourID@';
  const cmd = buildSignCmd(idName, msg);

  return (
    <div className="bg-gray-900 rounded-lg p-4 space-y-3 border border-gray-700">
      <h4 className="text-white font-medium text-sm">Mark as Delivered</h4>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Delivery Message (optional)</label>
        <textarea
          value={deliveryMsg}
          onChange={(e) => setDeliveryMsg(e.target.value)}
          rows={2}
          className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:border-verus-blue focus:outline-none"
          placeholder="Describe what was delivered..."
        />
      </div>
      <p className="text-gray-400 text-xs">Sign this message (CLI or GUI console):</p>
      <div className="bg-gray-950 rounded p-3 font-mono text-xs text-verus-blue break-all whitespace-pre-wrap select-all">
        {cmd}
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Paste Signature</label>
        <input
          type="text"
          value={sig}
          onChange={(e) => setSig(e.target.value)}
          className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm focus:border-verus-blue focus:outline-none"
          placeholder="AW1B..."
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => onSubmit({ signature: sig.trim(), timestamp: ts, deliveryMessage: deliveryMsg })}
          disabled={!sig.trim() || loading}
          className="btn-primary text-sm"
        >
          {loading ? 'Submitting...' : 'Submit Delivery'}
        </button>
        <button onClick={onCancel} className="btn-secondary text-sm">Cancel</button>
      </div>
    </div>
  );
}

export default function JobActions({ job, onUpdate }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [signPanel, setSignPanel] = useState(null);
  const [signatureInput, setSignatureInput] = useState('');

  const isBuyer = job.buyerVerusId === user?.verusId;
  const isSeller = job.sellerVerusId === user?.verusId;

  async function handleAction(action, body = {}) {
    setLoading(true);
    setError(null);
    try {
      const timestamp = body.timestamp || Math.floor(Date.now() / 1000);
      const { timestamp: _, ...restBody } = body;
      const res = await fetch(`${API_BASE}/v1/jobs/${job.id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ timestamp, ...restBody }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Action failed');
      setSignPanel(null);
      setSignatureInput('');
      if (onUpdate) onUpdate();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (['completed', 'cancelled'].includes(job.status)) return null;

  return (
    <div className="space-y-3">
      {error && <div className="text-red-400 text-sm">{error}</div>}

      {/* Action Buttons */}
      <div className="flex gap-2 flex-wrap">
        {/* Seller: Accept */}
        {isSeller && job.status === 'requested' && !signPanel && (
          <button
            onClick={() => {
              const ts = Math.floor(Date.now() / 1000);
              const msg = `VAP-ACCEPT|Job:${job.jobHash}|Buyer:${job.buyerVerusId}|Amt:${job.amount} ${job.currency}|Ts:${ts}|I accept this job and commit to delivering the work.`;
              const idName = user?.identityName ? `${user.identityName}@` : 'yourID@';
              const cmd = buildSignCmd(idName, msg);
              setSignPanel({ action: 'accept', message: msg, command: cmd, timestamp: ts });
              setSignatureInput('');
            }}
            disabled={loading}
            className="btn-primary text-sm"
          >
            Accept Job
          </button>
        )}

        {/* Buyer: Submit payment */}
        {isBuyer && job.status === 'accepted' && !job.payment?.txid && !signPanel && (
          <button
            onClick={() => { setSignPanel({ action: 'payment', type: 'txid' }); setSignatureInput(''); }}
            disabled={loading}
            className="btn-primary text-sm"
          >
            Submit Payment
          </button>
        )}

        {/* Status messages */}
        {isBuyer && job.status === 'accepted' && job.payment?.txid && (
          <span className="text-yellow-400 text-sm">⏳ Payment submitted — verifying...</span>
        )}
        {isSeller && job.status === 'accepted' && (
          <span className="text-yellow-400 text-sm">⏳ Waiting for buyer payment...</span>
        )}

        {/* Seller: Deliver */}
        {isSeller && job.status === 'in_progress' && !signPanel && (
          <button
            onClick={() => { setSignPanel({ action: 'deliver', type: 'delivery' }); setSignatureInput(''); }}
            disabled={loading}
            className="btn-primary text-sm"
          >
            Mark Delivered
          </button>
        )}

        {/* Buyer: Complete */}
        {isBuyer && job.status === 'delivered' && !signPanel && (
          <button
            onClick={() => {
              const ts = Math.floor(Date.now() / 1000);
              const msg = `VAP-COMPLETE|Job:${job.jobHash}|Ts:${ts}|I confirm the work has been delivered satisfactorily.`;
              const idName = user?.identityName ? `${user.identityName}@` : 'yourID@';
              const cmd = buildSignCmd(idName, msg);
              setSignPanel({ action: 'complete', message: msg, command: cmd, timestamp: ts });
              setSignatureInput('');
            }}
            disabled={loading}
            className="btn-primary text-sm"
          >
            Confirm Complete
          </button>
        )}

        {/* Cancel (buyer, requested only) */}
        {isBuyer && job.status === 'requested' && (
          <button onClick={() => handleAction('cancel')} disabled={loading} className="btn-danger text-sm">
            Cancel
          </button>
        )}

        {/* Dispute */}
        {!['completed', 'cancelled', 'disputed'].includes(job.status) && (
          <button onClick={() => handleAction('dispute')} disabled={loading} className="btn-danger text-sm">
            Dispute
          </button>
        )}
      </div>

      {/* Sign Panel (accept/complete) */}
      {signPanel && signPanel.type !== 'txid' && signPanel.type !== 'delivery' && (
        <div className="bg-gray-900 rounded-lg p-4 space-y-3 border border-gray-700">
          <h4 className="text-white font-medium text-sm">Sign to {signPanel.action}</h4>
          <p className="text-gray-400 text-xs">Copy the command, run it in CLI or GUI console, paste the signature.</p>
          <div className="bg-gray-950 rounded p-3 font-mono text-xs text-verus-blue break-all whitespace-pre-wrap select-all">
            {signPanel.command}
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Paste Signature</label>
            <input
              type="text" value={signatureInput} onChange={(e) => setSignatureInput(e.target.value)}
              className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm focus:border-verus-blue focus:outline-none"
              placeholder="AW1B..."
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { handleAction(signPanel.action, { signature: signatureInput.trim(), timestamp: signPanel.timestamp }); }}
              disabled={!signatureInput.trim() || loading}
              className="btn-primary text-sm"
            >
              {loading ? 'Submitting...' : 'Submit'}
            </button>
            <button onClick={() => { setSignPanel(null); setSignatureInput(''); }} className="btn-secondary text-sm">Cancel</button>
          </div>
        </div>
      )}

      {/* Payment Panel */}
      {signPanel && signPanel.type === 'txid' && (
        <div className="bg-gray-900 rounded-lg p-4 space-y-3 border border-gray-700">
          <h4 className="text-white font-medium text-sm">Submit Payment</h4>
          <p className="text-gray-400 text-xs">
            Send <span className="text-white font-medium">{job.amount} {job.currency}</span> to the seller, then paste the transaction ID.
          </p>
          <div className="bg-gray-950 rounded p-3">
            <span className="text-xs text-gray-500">Payment address:</span>
            <p className="text-verus-blue font-mono text-sm mt-1 break-all">{job.payment?.address || job.sellerVerusId}</p>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Transaction ID (64-char hex)</label>
            <input
              type="text" value={signatureInput} onChange={(e) => setSignatureInput(e.target.value)}
              className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm focus:border-verus-blue focus:outline-none"
              placeholder="abc123def456..."
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { handleAction('payment', { txid: signatureInput.trim() }); }}
              disabled={!signatureInput.trim() || loading}
              className="btn-primary text-sm"
            >
              {loading ? 'Verifying...' : 'Submit Payment'}
            </button>
            <button onClick={() => { setSignPanel(null); setSignatureInput(''); }} className="btn-secondary text-sm">Cancel</button>
          </div>
        </div>
      )}

      {/* Delivery Panel */}
      {signPanel && signPanel.type === 'delivery' && (
        <DeliveryPanel
          job={job} user={user} loading={loading}
          onSubmit={(body) => handleAction('deliver', body)}
          onCancel={() => { setSignPanel(null); setSignatureInput(''); }}
        />
      )}
    </div>
  );
}
