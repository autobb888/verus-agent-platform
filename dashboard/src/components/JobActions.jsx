import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import QRCode from 'react-qr-code';

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

/**
 * PaymentQR — generates a VerusPay invoice QR via the server endpoint.
 * Verus Mobile natively understands VerusPay invoices.
 */
function PaymentQR({ jobId, type, amount, currency, onTxDetected }) {
  const [qrData, setQrData] = useState(null);
  const [qrError, setQrError] = useState(null);
  const [polling, setPolling] = useState(true);
  const intervalRef = useRef(null);
  const seenTxidsRef = useRef(new Set());

  // Fetch VerusPay invoice from server
  useEffect(() => {
    let mounted = true;
    async function fetchQr() {
      try {
        const res = await fetch(`${API_BASE}/v1/jobs/${jobId}/payment-qr?type=${type}`, { credentials: 'include' });
        if (res.ok && mounted) {
          const data = await res.json();
          setQrData(data.data);
        } else if (mounted) {
          setQrError('Failed to generate payment QR');
        }
      } catch {
        if (mounted) setQrError('Failed to generate payment QR');
      }
    }
    fetchQr();

    // Snapshot existing txids
    async function snapshotExisting() {
      try {
        const res = await fetch(`${API_BASE}/v1/jobs/${jobId}`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          if (data.data?.payment?.txid) seenTxidsRef.current.add(data.data.payment.txid);
          if (data.data?.payment?.platformFeeTxid) seenTxidsRef.current.add(data.data.payment.platformFeeTxid);
        }
      } catch {}
    }
    snapshotExisting();

    // Poll for payment detection
    intervalRef.current = setInterval(async () => {
      if (!mounted) return;
      try {
        const res = await fetch(`${API_BASE}/v1/jobs/${jobId}`, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        const job = data.data;
        if (job?.payment?.txid && !seenTxidsRef.current.has(job.payment.txid)) {
          onTxDetected?.(job.payment.txid, 'agent');
          seenTxidsRef.current.add(job.payment.txid);
        }
        if (job?.payment?.platformFeeTxid && !seenTxidsRef.current.has(job.payment.platformFeeTxid)) {
          onTxDetected?.(job.payment.platformFeeTxid, 'fee');
          seenTxidsRef.current.add(job.payment.platformFeeTxid);
        }
      } catch {}
    }, 10000);

    return () => {
      mounted = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [jobId, type]);

  if (qrError) {
    return <p className="text-xs text-red-400">{qrError}</p>;
  }

  if (!qrData) {
    return (
      <div className="flex items-center justify-center py-6">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-verus-blue"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="bg-white p-3 rounded-lg">
        <QRCode value={qrData.qrString} size={200} level="M" />
      </div>
      <p className="text-xs text-center" style={{ color: 'var(--text-tertiary)' }}>
        Scan with Verus Mobile to pay <span className="text-white font-medium">{qrData.amount?.toFixed?.(4) || amount} {currency}</span>
      </p>
      <div className="w-full bg-gray-950 rounded p-2 text-center">
        <p className="text-xs font-mono break-all" style={{ color: 'var(--text-secondary)' }}>{qrData.address}</p>
      </div>
      {qrData.deeplink && /^verus(id|pay)?:/i.test(qrData.deeplink) && (
        <a href={qrData.deeplink} className="text-xs text-verus-blue hover:underline">
          Open in Verus Mobile →
        </a>
      )}
      {polling && (
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
          <div className="animate-spin rounded-full h-3 w-3 border-b border-verus-blue"></div>
          Waiting for payment...
        </div>
      )}
    </div>
  );
}

function ExtensionPanel({ job, loading, onSubmit, onCancel }) {
  const [extAmount, setExtAmount] = useState('');
  const [extReason, setExtReason] = useState('');

  return (
    <div className="bg-gray-900 rounded-lg p-4 space-y-3 border border-gray-700">
      <h4 className="text-white font-medium text-sm">Request Session Extension</h4>
      <p className="text-gray-400 text-xs">Need more tokens/time? Request additional payment to extend the session. The other party must approve.</p>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Additional Amount ({job.currency})</label>
        <input
          type="number"
          step="0.01"
          min="0.001"
          value={extAmount}
          onChange={(e) => setExtAmount(e.target.value)}
          className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:border-verus-blue focus:outline-none"
          placeholder="e.g. 100"
        />
        {extAmount && Number(extAmount) > 0 && (
          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
            Total extension cost: {Number(extAmount).toFixed(4)} + {(Number(extAmount) * 0.05).toFixed(4)} fee = {(Number(extAmount) * 1.05).toFixed(4)} {job.currency}
          </p>
        )}
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Reason (optional)</label>
        <textarea
          value={extReason}
          onChange={(e) => setExtReason(e.target.value)}
          rows={2}
          maxLength={500}
          className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:border-verus-blue focus:outline-none"
          placeholder="e.g. Job requires more tokens than originally scoped..."
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => onSubmit({ amount: Number(extAmount), reason: extReason || undefined })}
          disabled={!extAmount || Number(extAmount) <= 0 || loading}
          className="btn-primary text-sm"
        >
          {loading ? 'Submitting...' : 'Request Extension'}
        </button>
        <button onClick={onCancel} className="btn-secondary text-sm">Cancel</button>
      </div>
    </div>
  );
}

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
          maxLength={1000}
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

        {/* Buyer: Submit agent payment */}
        {isBuyer && job.status === 'accepted' && !job.payment?.txid && !signPanel && (
          <button
            onClick={() => { setSignPanel({ action: 'payment', type: 'txid' }); setSignatureInput(''); }}
            disabled={loading}
            className="btn-primary text-sm"
          >
            Pay Agent ({job.amount} {job.currency})
          </button>
        )}

        {/* Buyer: Submit platform fee */}
        {isBuyer && job.status === 'accepted' && job.payment?.txid && !job.payment?.platformFeeTxid && !signPanel && (
          <button
            onClick={() => { setSignPanel({ action: 'platform-fee', type: 'fee-txid' }); setSignatureInput(''); }}
            disabled={loading}
            className="btn-primary text-sm"
          >
            Pay Platform Fee ({job.payment?.feeAmount?.toFixed(4)} {job.currency})
          </button>
        )}

        {/* Status messages */}
        {isBuyer && job.status === 'accepted' && job.payment?.txid && job.payment?.platformFeeTxid && (
          <span className="text-yellow-400 text-sm">⏳ Both payments submitted — verifying...</span>
        )}
        {isBuyer && job.status === 'accepted' && job.payment?.txid && !job.payment?.platformFeeTxid && (
          <span className="text-green-400 text-sm">✓ Agent payment submitted — now pay platform fee</span>
        )}
        {isSeller && job.status === 'accepted' && (
          <span className="text-yellow-400 text-sm">⏳ Waiting for buyer payment...</span>
        )}

        {/* Extension request button (in-progress jobs) */}
        {(isBuyer || isSeller) && job.status === 'in_progress' && !signPanel && (
          <button
            onClick={() => { setSignPanel({ action: 'extension', type: 'extension' }); setSignatureInput(''); }}
            disabled={loading}
            className="btn-secondary text-sm"
          >
            Request Extension
          </button>
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

      {/* Agent Payment Panel */}
      {signPanel && signPanel.type === 'txid' && (
        <div className="bg-gray-900 rounded-lg p-4 space-y-3 border border-gray-700">
          <h4 className="text-white font-medium text-sm">Step 1: Pay Agent</h4>
          <p className="text-gray-400 text-xs">
            Send <span className="text-white font-medium">{job.amount} {job.currency}</span> to the agent. Scan the QR or paste the transaction ID manually.
          </p>

          <PaymentQR
            jobId={job.id}
            type="agent"
            amount={job.amount}
            currency={job.currency}
            onTxDetected={(txid, t) => {
              if (t === 'agent') setSignatureInput(txid);
            }}
          />

          <p className="text-gray-500 text-xs">After this, you'll also pay the 5% platform fee ({job.payment?.feeAmount?.toFixed(4)} {job.currency}) in a second transaction.</p>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Transaction ID (64-char hex) — auto-fills when payment detected</label>
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
              {loading ? 'Verifying...' : 'Submit Agent Payment'}
            </button>
            <button onClick={() => { setSignPanel(null); setSignatureInput(''); }} className="btn-secondary text-sm">Cancel</button>
          </div>
        </div>
      )}

      {/* Platform Fee Panel */}
      {signPanel && signPanel.type === 'fee-txid' && (
        <div className="bg-gray-900 rounded-lg p-4 space-y-3 border border-gray-700">
          <h4 className="text-white font-medium text-sm">Step 2: Pay Platform Fee</h4>
          <p className="text-gray-400 text-xs">
            Send <span className="text-white font-medium">{job.payment?.feeAmount?.toFixed(4)} {job.currency}</span> (5% fee) to the SafeChat address. Scan the QR or paste manually.
          </p>

          <PaymentQR
            jobId={job.id}
            type="fee"
            amount={job.payment?.feeAmount}
            currency={job.currency}
            onTxDetected={(txid, t) => {
              if (t === 'fee') setSignatureInput(txid);
            }}
          />

          <p className="text-green-400 text-xs">✓ Agent payment already submitted. This is the final step — job starts after both payments.</p>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Transaction ID (64-char hex) — auto-fills when payment detected</label>
            <input
              type="text" value={signatureInput} onChange={(e) => setSignatureInput(e.target.value)}
              className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm focus:border-verus-blue focus:outline-none"
              placeholder="abc123def456..."
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { handleAction('platform-fee', { txid: signatureInput.trim() }); }}
              disabled={!signatureInput.trim() || loading}
              className="btn-primary text-sm"
            >
              {loading ? 'Verifying...' : 'Submit Platform Fee'}
            </button>
            <button onClick={() => { setSignPanel(null); setSignatureInput(''); }} className="btn-secondary text-sm">Cancel</button>
          </div>
        </div>
      )}

      {/* Extension Request Panel */}
      {signPanel && signPanel.type === 'extension' && (
        <ExtensionPanel
          job={job} loading={loading}
          onSubmit={async (body) => {
            setLoading(true);
            setError(null);
            try {
              const res = await fetch(`${API_BASE}/v1/jobs/${job.id}/extensions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(body),
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error?.message || 'Failed to request extension');
              setSignPanel(null);
              if (onUpdate) onUpdate();
            } catch (err) {
              setError(err.message);
            } finally {
              setLoading(false);
            }
          }}
          onCancel={() => { setSignPanel(null); setSignatureInput(''); }}
        />
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
