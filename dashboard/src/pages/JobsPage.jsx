import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ResolvedId from '../components/ResolvedId';
import JobStepper from '../components/JobStepper';
import { SkeletonList, EmptyState } from '../components/Skeleton';

const API_BASE = import.meta.env.VITE_API_URL || '';

function DeletionAttestationSection({ jobId, jobHash, user }) {
  const [attestation, setAttestation] = useState(null);
  const [showSign, setShowSign] = useState(false);
  const [sig, setSig] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState('');
  const [ts, setTs] = useState(Math.floor(Date.now() / 1000));

  useEffect(() => {
    fetch(`${API_BASE}/v1/jobs/${jobId}/deletion-attestation`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.data) setAttestation(d.data); })
      .catch(() => {});
  }, [jobId]);

  const fetchMessage = async () => {
    const newTs = Math.floor(Date.now() / 1000);
    setTs(newTs);
    try {
      const res = await fetch(`${API_BASE}/v1/jobs/${jobId}/deletion-attestation/message?timestamp=${newTs}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setMsg(data.data.message);
        setTs(data.data.timestamp);
      }
    } catch {}
    setShowSign(true);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/v1/jobs/${jobId}/deletion-attestation`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ signature: sig.trim(), timestamp: ts }),
      });
      const data = await res.json();
      if (res.ok) setAttestation({ signed: true, signatureVerified: data.data.signatureVerified });
    } catch {}
    setSubmitting(false);
  };

  if (attestation) {
    return (
      <div className="rounded-lg border p-3" style={{ borderColor: '#10b98133', backgroundColor: '#10b98110' }}>
        <p className="text-sm text-emerald-400">✅ Deletion attestation signed</p>
        <p className="text-xs text-gray-400 mt-1">
          Signature {attestation.signatureVerified ? 'verified ✓' : 'pending verification'}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: '#f59e0b33', backgroundColor: '#f59e0b10' }}>
      <p className="text-sm text-amber-400">⚠️ Deletion attestation requested</p>
      <p className="text-xs text-gray-400">The buyer requires you to attest that job data has been deleted.</p>
      {!showSign ? (
        <button onClick={fetchMessage} className="text-xs px-3 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white">
          Sign Attestation
        </button>
      ) : (
        <div className="space-y-2">
          <pre className="text-xs p-2 bg-gray-900 rounded overflow-x-auto text-gray-300 whitespace-pre-wrap">{msg}</pre>
          <p className="text-xs text-gray-500">
            Run in CLI or GUI console: <code className="text-xs bg-gray-800 px-1 rounded">signmessage "{user?.identityName}@" "{msg}"</code>
          </p>
          <input value={sig} onChange={e => setSig(e.target.value)} placeholder="Paste signature..."
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white" />
          <button onClick={handleSubmit} disabled={!sig.trim() || submitting}
            className="text-xs px-3 py-1 rounded bg-verus-blue hover:opacity-90 text-white disabled:opacity-50">
            {submitting ? 'Submitting...' : 'Submit Attestation'}
          </button>
        </div>
      )}
    </div>
  );
}

function DeletionAttestationView({ jobId }) {
  const [attestation, setAttestation] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/v1/jobs/${jobId}/deletion-attestation`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.data) setAttestation(d.data); })
      .catch(() => {});
  }, [jobId]);

  if (!attestation) return null;

  return (
    <div className="rounded-lg border p-3" style={{ borderColor: '#10b98133', backgroundColor: '#10b98110' }}>
      <p className="text-sm text-emerald-400">✅ Seller attested to data deletion</p>
      <p className="text-xs text-gray-400 mt-1">
        Signed: {attestation.createdAt ? new Date(attestation.createdAt).toLocaleString() : 'Unknown'}
        {attestation.signatureVerified ? ' • Verified ✓' : ''}
      </p>
      <p className="text-xs text-gray-500 mt-1 italic">
        This is a legal commitment, not a technical guarantee.
      </p>
    </div>
  );
}

// Status badges now use CSS classes from index.css (badge + badge-{status})

function DeliveryPanel({ job, user, loading, onSubmit, onCancel }) {
  const [hash, setHash] = useState('');
  const [msg, setMsg] = useState('');
  const [sig, setSig] = useState('');
  const [ts] = useState(Math.floor(Date.now() / 1000));

  const signMsg = `VAP-DELIVER|Job:${job.jobHash}|Delivery:${hash}|Ts:${ts}|I have delivered the work for this job.`;
  const idName = user?.identityName ? `${user.identityName}@` : 'yourID@';
  const cmd = `signmessage "${idName}" "${signMsg.replace(/"/g, '\\"')}"`;
  const msgLines = [signMsg]; // compat

  return (
    <div className="mt-4 bg-gray-900 rounded-lg p-4 space-y-3 border border-gray-700">
      <h4 className="text-white font-medium text-sm">Mark as Delivered</h4>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Delivery Hash/URL</label>
        <input type="text" value={hash} onChange={e => setHash(e.target.value)}
          className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:border-verus-blue focus:outline-none"
          placeholder="IPFS hash, URL, or file hash..." />
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Message (optional)</label>
        <input type="text" value={msg} onChange={e => setMsg(e.target.value)}
          className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:border-verus-blue focus:outline-none"
          placeholder="Notes about the delivery..." />
      </div>
      {hash && (
        <>
          <div className="bg-gray-950 rounded p-3">
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs text-gray-500">Sign command:</span>
              <button onClick={() => navigator.clipboard.writeText(cmd)} className="text-verus-blue text-xs">Copy</button>
            </div>
            <code className="text-xs text-verus-blue break-all">{cmd}</code>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Paste Signature</label>
            <input type="text" value={sig} onChange={e => setSig(e.target.value)}
              className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm focus:border-verus-blue focus:outline-none"
              placeholder="AW1B..." />
          </div>
        </>
      )}
      <div className="flex gap-2">
        <button
          onClick={() => onSubmit({ deliveryHash: hash, deliveryMessage: msg, signature: sig.trim(), timestamp: ts })}
          disabled={!hash || !sig.trim() || loading}
          className="btn-primary text-sm"
        >{loading ? 'Submitting...' : 'Submit Delivery'}</button>
        <button onClick={onCancel} className="btn-secondary text-sm">Cancel</button>
      </div>
    </div>
  );
}

export default function JobsPage() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all'); // all, buyer, seller
  const [statusFilter, setStatusFilter] = useState('');
  const [counts, setCounts] = useState({ asBuyer: {}, asSeller: {} });

  useEffect(() => {
    fetchJobs();
  }, [filter, statusFilter]);

  async function fetchJobs() {
    setLoading(true);
    try {
      let url = `${API_BASE}/v1/me/jobs?`;
      if (filter !== 'all') url += `role=${filter}&`;
      if (statusFilter) url += `status=${statusFilter}&`;

      const res = await fetch(url, { credentials: 'include' });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error?.message || 'Failed to fetch jobs');

      setJobs(data.data || []);
      setCounts(data.meta || { asBuyer: {}, asSeller: {} });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function formatDate(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  const totalAsBuyer = Object.values(counts.asBuyer).reduce((a, b) => a + b, 0);
  const totalAsSeller = Object.values(counts.asSeller).reduce((a, b) => a + b, 0);
  const pendingAsSeller = (counts.asSeller.requested || 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-white">Jobs</h1>
          <p className="text-gray-400 mt-1">
            {totalAsBuyer} as buyer · {totalAsSeller} as seller
            {pendingAsSeller > 0 && (
              <span className="text-yellow-400 ml-2">
                ({pendingAsSeller} pending requests)
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-4 flex-wrap">
        <div className="flex bg-gray-800 rounded-lg p-1">
          {['all', 'buyer', 'seller'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                filter === f
                  ? 'bg-verus-blue text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {f === 'all' ? 'All' : f === 'buyer' ? 'As Buyer' : 'As Seller'}
            </button>
          ))}
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white focus:border-verus-blue focus:outline-none"
        >
          <option value="">All Statuses</option>
          <option value="requested">Requested</option>
          <option value="accepted">Accepted</option>
          <option value="in_progress">In Progress</option>
          <option value="delivered">Delivered</option>
          <option value="completed">Completed</option>
          <option value="disputed">Disputed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {/* Jobs List */}
      {loading ? (
        <SkeletonList count={3} lines={3} />
      ) : error ? (
        <div className="bg-red-900/50 border border-red-700 rounded-lg p-4 text-red-300">
          {error}
        </div>
      ) : jobs.length === 0 ? (
        <EmptyState
          icon="💼"
          title="No jobs yet"
          message="Hire an agent from the marketplace to get started, or list your services to receive job requests."
          action={<Link to="/marketplace" className="btn-primary">Browse Marketplace →</Link>}
        />
      ) : (
        <div className="space-y-4">
          {jobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              currentUser={user?.verusId}
              onUpdate={fetchJobs}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function JobCard({ job, currentUser, onUpdate }) {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [signPanel, setSignPanel] = useState(null); // { action, message, command, timestamp }
  const [signatureInput, setSignatureInput] = useState('');

  const isBuyer = job.buyerVerusId === currentUser;
  const isSeller = job.sellerVerusId === currentUser;
  const role = isBuyer ? 'buyer' : 'seller';

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

      onUpdate();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <span className={`badge badge-${job.status}`}>
              {job.status.replace('_', ' ')}
            </span>
            <span className="text-gray-500 text-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {isBuyer ? 'To:' : 'From:'}
              <ResolvedId
                address={isBuyer ? job.sellerVerusId : job.buyerVerusId}
                size="sm"
                showAddress={true}
              />
            </span>
          </div>
          <p className="text-white mt-2 line-clamp-2">{job.description}</p>
          <div className="mt-2">
            <JobStepper status={job.status} hasPayment={!!job.payment?.txid} />
          </div>
          <p className="text-gray-500 text-sm mt-1">
            {job.amount} {job.currency} · Created {new Date(job.timestamps.created).toLocaleDateString()}
          </p>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-gray-400 hover:text-white ml-4"
        >
          {expanded ? '▲' : '▼'}
        </button>
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-gray-700 space-y-4">
          {/* Payment info */}
          <div className="bg-gray-900 rounded p-3">
            <p className="text-sm text-gray-400">Payment</p>
            <p className="text-white">
              {job.amount} {job.currency}
              {job.payment.txid ? (
                <span className="text-green-400 ml-2">✓ Paid</span>
              ) : (
                <span className="text-yellow-400 ml-2">· Awaiting payment</span>
              )}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {isBuyer 
                ? `You pay → seller (${job.payment.terms === 'prepay' ? 'before work starts' : 'after delivery'})`
                : `Buyer pays you (${job.payment.terms === 'prepay' ? 'before work starts' : 'after delivery'})`
              }
            </p>
          </div>

          {/* Timeline */}
          <div className="text-sm text-gray-400 space-y-1">
            <p>Requested: {new Date(job.timestamps.requested).toLocaleString()}</p>
            {job.timestamps.accepted && <p>Accepted: {new Date(job.timestamps.accepted).toLocaleString()}</p>}
            {job.timestamps.delivered && <p>Delivered: {new Date(job.timestamps.delivered).toLocaleString()}</p>}
            {job.timestamps.completed && <p>Completed: {new Date(job.timestamps.completed).toLocaleString()}</p>}
          </div>

          {/* Delivery info */}
          {job.delivery && (
            <div className="bg-gray-900 rounded p-3">
              <p className="text-sm text-gray-400">Delivery</p>
              <p className="text-white break-all">{job.delivery.hash}</p>
              {job.delivery.message && (
                <p className="text-gray-300 mt-1">{job.delivery.message}</p>
              )}
            </div>
          )}

          {/* Deletion Attestation for completed jobs */}
          {job.status === 'completed' && isSeller && (
            <DeletionAttestationSection jobId={job.id} jobHash={job.jobHash} user={user} />
          )}
          {job.status === 'completed' && !isSeller && (
            <DeletionAttestationView jobId={job.id} />
          )}

          {error && (
            <div className="text-red-400 text-sm">{error}</div>
          )}

          {/* Actions */}
          <div className="flex gap-2 flex-wrap">
            {/* Seller actions */}
            {isSeller && job.status === 'requested' && !signPanel && (
              <button
                onClick={() => {
                  const ts = Math.floor(Date.now() / 1000);
                  const msg = `VAP-ACCEPT|Job:${job.jobHash}|Buyer:${job.buyerVerusId}|Amt:${job.amount} ${job.currency}|Ts:${ts}|I accept this job and commit to delivering the work.`;
                  const idName = user?.identityName ? `${user.identityName}@` : 'yourID@';
                  const cmd = `signmessage "${idName}" "${msg.replace(/"/g, '\\"')}"`;
                  setSignPanel({ action: 'accept', message: msg, command: cmd, timestamp: ts });
                  setSignatureInput('');
                }}
                disabled={loading}
                className="btn-primary text-sm"
              >
                Accept Job
              </button>
            )}

            {/* Buyer: Submit payment txid */}
            {isBuyer && job.status === 'accepted' && !job.payment?.txid && !signPanel && (
              <button
                onClick={() => {
                  setSignPanel({ action: 'payment', type: 'txid' });
                  setSignatureInput('');
                }}
                disabled={loading}
                className="btn-primary text-sm"
              >
                Submit Payment
              </button>
            )}

            {/* Buyer: Payment submitted, waiting */}
            {isBuyer && job.status === 'accepted' && job.payment?.txid && (
              <span className="text-yellow-400 text-sm">⏳ Payment submitted — verifying...</span>
            )}

            {/* Seller: Waiting for payment */}
            {isSeller && job.status === 'accepted' && (
              <span className="text-yellow-400 text-sm">⏳ Waiting for buyer payment...</span>
            )}

            {isSeller && (job.status === 'in_progress') && !signPanel && (
              <button
                onClick={() => {
                  setSignPanel({ action: 'deliver', type: 'delivery' });
                  setSignatureInput('');
                }}
                disabled={loading}
                className="btn-primary text-sm"
              >
                Mark Delivered
              </button>
            )}

            {/* Buyer actions */}
            {isBuyer && job.status === 'delivered' && !signPanel && (
              <button
                onClick={() => {
                  const ts = Math.floor(Date.now() / 1000);
                  const msg = `VAP-COMPLETE|Job:${job.jobHash}|Ts:${ts}|I confirm the work has been delivered satisfactorily.`;
                  const idName = user?.identityName ? `${user.identityName}@` : 'yourID@';
                  const cmd = `signmessage "${idName}" "${msg.replace(/"/g, '\\"')}"`;
                  setSignPanel({ action: 'complete', message: msg, command: cmd, timestamp: ts });
                  setSignatureInput('');
                }}
                disabled={loading}
                className="btn-primary text-sm"
              >
                Confirm Complete
              </button>
            )}

            {isBuyer && job.status === 'requested' && (
              <button
                onClick={() => handleAction('cancel')}
                disabled={loading}
                className="btn-danger text-sm"
              >
                Cancel
              </button>
            )}

            {/* Common actions */}
            {!['completed', 'cancelled', 'disputed'].includes(job.status) && (
              <button
                onClick={() => handleAction('dispute')}
                disabled={loading}
                className="btn-danger text-sm"
              >
                Dispute
              </button>
            )}

            <Link
              to={`/jobs/${job.id}`}
              className="btn-secondary text-sm"
            >
              View Details
            </Link>
          </div>

          {/* Sign Panel */}
          {signPanel && signPanel.type !== 'txid' && signPanel.type !== 'delivery' && (
            <div className="mt-4 bg-gray-900 rounded-lg p-4 space-y-3 border border-gray-700">
              <h4 className="text-white font-medium text-sm">Sign to {signPanel.action}</h4>
              <p className="text-gray-400 text-xs">
                Copy the command below, run it in your terminal, and paste the signature.
              </p>
              <div className="bg-gray-950 rounded p-3 font-mono text-xs text-verus-blue break-all whitespace-pre-wrap select-all">
                {signPanel.command}
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Paste Signature</label>
                <input
                  type="text"
                  value={signatureInput}
                  onChange={(e) => setSignatureInput(e.target.value)}
                  className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm focus:border-verus-blue focus:outline-none"
                  placeholder="AW1B..."
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (signatureInput.trim()) {
                      handleAction(signPanel.action, {
                        signature: signatureInput.trim(),
                        timestamp: signPanel.timestamp,
                      });
                      setSignPanel(null);
                      setSignatureInput('');
                    }
                  }}
                  disabled={!signatureInput.trim() || loading}
                  className="btn-primary text-sm"
                >
                  {loading ? 'Submitting...' : 'Submit'}
                </button>
                <button
                  onClick={() => { setSignPanel(null); setSignatureInput(''); }}
                  className="btn-secondary text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Payment Panel */}
          {signPanel && signPanel.type === 'txid' && (
            <div className="mt-4 bg-gray-900 rounded-lg p-4 space-y-3 border border-gray-700">
              <h4 className="text-white font-medium text-sm">Submit Payment</h4>
              <p className="text-gray-400 text-xs">
                Send <span className="text-white font-medium">{job.amount} {job.currency}</span> to the seller, then paste the transaction ID below.
              </p>
              <div className="bg-gray-950 rounded p-3">
                <span className="text-xs text-gray-500">Payment address:</span>
                <p className="text-verus-blue font-mono text-sm mt-1 break-all">{job.payment?.address || job.sellerVerusId}</p>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Transaction ID (64-char hex)</label>
                <input
                  type="text"
                  value={signatureInput}
                  onChange={(e) => setSignatureInput(e.target.value)}
                  className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm focus:border-verus-blue focus:outline-none"
                  placeholder="abc123def456..."
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (signatureInput.trim()) {
                      handleAction('payment', { txid: signatureInput.trim() });
                      setSignPanel(null);
                      setSignatureInput('');
                    }
                  }}
                  disabled={!signatureInput.trim() || loading}
                  className="btn-primary text-sm"
                >
                  {loading ? 'Verifying...' : 'Submit Payment'}
                </button>
                <button
                  onClick={() => { setSignPanel(null); setSignatureInput(''); }}
                  className="btn-secondary text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Delivery Panel */}
          {signPanel && signPanel.type === 'delivery' && (
            <DeliveryPanel
              job={job}
              user={user}
              loading={loading}
              onSubmit={(body) => { handleAction('deliver', body); setSignPanel(null); }}
              onCancel={() => { setSignPanel(null); setSignatureInput(''); }}
            />
          )}
        </div>
      )}
    </div>
  );
}
