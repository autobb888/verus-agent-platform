import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ResolvedId from '../components/ResolvedId';
import CopyButton from '../components/CopyButton';

const API_BASE = import.meta.env.VITE_API_URL || '';

function JobAcceptPanel({ job, onAccepted }) {
  const { user } = useAuth();
  const [timestamp] = useState(Math.floor(Date.now() / 1000));
  const [signature, setSignature] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const signMsg = `VAP-ACCEPT|Job:${job.jobHash}|Buyer:${job.buyerVerusId}|Amt:${job.amount} ${job.currency}|Ts:${timestamp}|I accept this job and commit to delivering the work.`;
  const displayMsg = signMsg;
  const idName = user?.identityName ? `${user.identityName}@` : 'yourID@';
  const command = `signmessage "${idName}" "${signMsg.replace(/"/g, '\\"')}"`;

  async function handleAccept() {
    if (!signature.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/v1/jobs/${job.id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ timestamp, signature: signature.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Failed to accept job');
      onAccepted?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ marginTop: 20 }} className="space-y-4">
      <h4 className="text-white font-medium">Accept This Job</h4>
      <p className="text-gray-400 text-sm">
        Sign the message below to accept this job request.
      </p>

      {/* Message to sign */}
      <pre className="bg-gray-950 rounded-lg p-4 text-xs text-gray-300 font-mono whitespace-pre-wrap">
        {displayMsg}
      </pre>

      {/* Command */}
      <div className="bg-gray-950 rounded-lg p-3">
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs text-gray-500">Run this command:</span>
          <CopyButton text={command} label="Copy" />
        </div>
        <code className="text-xs text-verus-blue break-all">{command}</code>
      </div>

      {/* Signature input */}
      <div>
        <label className="block text-sm text-gray-400 mb-1">Paste Signature</label>
        <input
          type="text"
          value={signature}
          onChange={(e) => setSignature(e.target.value)}
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm focus:border-verus-blue focus:outline-none"
          placeholder="AW1B..."
        />
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <button
        onClick={handleAccept}
        disabled={!signature.trim() || loading}
        className="btn-primary w-full"
      >
        {loading ? 'Accepting...' : 'Accept Job'}
      </button>
    </div>
  );
}

function JobTimeline({ item }) {
  const job = item.jobDetails;
  if (!job) return null;

  const steps = [
    {
      icon: '📋',
      label: 'Job Requested',
      detail: `${job.description}`,
      sub: `${job.amount} ${job.currency} · ${job.paymentTerms}`,
      time: job.timestamps.requested,
      done: true,
      sig: job.signatures.request,
    },
    {
      icon: '✅',
      label: 'Accepted by Seller',
      detail: job.signatures.acceptance ? 'Seller signed acceptance' : 'Awaiting seller acceptance',
      time: job.timestamps.accepted,
      done: !!job.timestamps.accepted,
      sig: job.signatures.acceptance,
    },
    {
      icon: '💰',
      label: 'Payment',
      detail: job.paymentTxid
        ? `Paid · tx: ${job.paymentTxid.slice(0, 12)}...${job.paymentTxid.slice(-8)}`
        : 'Awaiting buyer payment',
      done: !!job.paymentTxid,
    },
    {
      icon: '📦',
      label: 'Delivered',
      detail: job.deliveryHash
        ? `Delivery: ${job.deliveryHash.slice(0, 20)}${job.deliveryHash.length > 20 ? '...' : ''}`
        : 'Awaiting delivery',
      time: job.timestamps.delivered,
      done: !!job.timestamps.delivered,
      sig: job.signatures.delivery,
    },
    {
      icon: '🎉',
      label: 'Completed',
      detail: job.signatures.completion ? 'Buyer confirmed completion' : 'Awaiting buyer confirmation',
      time: job.timestamps.completed,
      done: !!job.timestamps.completed,
      sig: job.signatures.completion,
    },
  ];

  // Find current step
  const currentIdx = steps.findLastIndex(s => s.done);

  return (
    <div>
      {/* Job header */}
      <div style={{ marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>{job.description}</p>
        <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
          <ResolvedId address={job.buyerVerusId} size="sm" />
          <span style={{ color: 'var(--text-muted)', alignSelf: 'center' }}>→</span>
          <ResolvedId address={job.sellerVerusId} size="sm" />
        </div>
        <div style={{ marginTop: 8 }}>
          <span style={{
            display: 'inline-block',
            padding: '2px 10px',
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            background: job.status === 'completed' ? 'rgba(34,197,94,0.15)' : job.status === 'in_progress' ? 'rgba(168,85,247,0.15)' : 'rgba(59,130,246,0.15)',
            color: job.status === 'completed' ? '#4ade80' : job.status === 'in_progress' ? '#c084fc' : '#60a5fa',
          }}>
            {job.status.replace('_', ' ')}
          </span>
        </div>
      </div>

      {/* Timeline */}
      <div style={{ position: 'relative', paddingLeft: 28 }}>
        {steps.map((step, i) => (
          <div key={i} style={{ position: 'relative', paddingBottom: i < steps.length - 1 ? 20 : 0, opacity: step.done ? 1 : 0.4 }}>
            {/* Connector line */}
            {i < steps.length - 1 && (
              <div style={{
                position: 'absolute',
                left: -18,
                top: 24,
                bottom: 0,
                width: 2,
                background: step.done ? 'rgba(59,130,246,0.4)' : 'rgba(255,255,255,0.06)',
              }} />
            )}
            {/* Icon */}
            <div style={{
              position: 'absolute',
              left: -28,
              top: 0,
              width: 22,
              height: 22,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 13,
            }}>
              {step.done ? step.icon : '○'}
            </div>
            {/* Content */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: step.done ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                  {step.label}
                </span>
                {step.sig && (
                  <span style={{ fontSize: 10, color: '#4ade80', fontWeight: 500 }}>{step.sig}</span>
                )}
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{step.detail}</p>
              {step.time && (
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {new Date(step.time).toLocaleString()}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function InboxPage() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedItem, setSelectedItem] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    fetchInbox();
  }, []);

  async function fetchInbox() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/v1/me/inbox`, {
        credentials: 'include',
      });
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to fetch inbox');
      }
      
      setItems(data.data || []);
      setPendingCount(data.meta?.pendingCount || 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function fetchItemDetails(id) {
    try {
      const res = await fetch(`${API_BASE}/v1/me/inbox/${id}`, {
        credentials: 'include',
      });
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to fetch item');
      }
      
      setSelectedItem(data.data);
    } catch (err) {
      setError(err.message);
    }
  }

  async function rejectItem(id) {
    if (!confirm('Are you sure you want to reject this review?')) return;
    
    try {
      const res = await fetch(`${API_BASE}/v1/me/inbox/${id}/reject`, {
        method: 'POST',
        credentials: 'include',
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || 'Failed to reject');
      }
      
      fetchInbox();
      setSelectedItem(null);
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-verus-blue"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Inbox</h1>
          <p className="text-gray-400 mt-1">
            Pending reviews and messages to add to your VerusID
          </p>
        </div>
        {pendingCount > 0 && (
          <span className="bg-verus-blue text-white px-3 py-1 rounded-full text-sm font-medium">
            {pendingCount} pending
          </span>
        )}
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded-lg p-4 text-red-400">
          {error}
        </div>
      )}

      {/* Unified Panel */}
      <div
        style={{
          display: 'flex',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 12,
          overflow: 'hidden',
          height: 'calc(100vh - 220px)',
          minHeight: 400,
        }}
      >
        {/* Left Panel - Item List */}
        <div
          style={{
            width: 340,
            minWidth: 340,
            borderRight: '1px solid var(--border-subtle)',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
            <h2 className="font-semibold text-white" style={{ fontSize: 14 }}>
              Pending Items
              {items.length > 0 && (
                <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 8 }}>
                  {items.length}
                </span>
              )}
            </h2>
          </div>
          
          {items.length === 0 ? (
            <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <span style={{ fontSize: 32, display: 'block', marginBottom: 12 }}>📭</span>
              <p>No pending items</p>
            </div>
          ) : (
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {items.map((item) => {
                const isSelected = selectedItem?.id === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => fetchItemDetails(item.id)}
                    style={{
                      width: '100%',
                      padding: '14px 20px',
                      textAlign: 'left',
                      background: isSelected ? 'rgba(96, 165, 250, 0.08)' : 'transparent',
                      borderLeft: isSelected ? '3px solid #60a5fa' : '3px solid transparent',
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                      cursor: 'pointer',
                      transition: 'background 0.15s',
                      border: 'none',
                      borderLeftWidth: 3,
                      borderLeftStyle: 'solid',
                      borderLeftColor: isSelected ? '#60a5fa' : 'transparent',
                      borderBottomWidth: 1,
                      borderBottomStyle: 'solid',
                      borderBottomColor: 'rgba(255,255,255,0.04)',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between' }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 16 }}>
                            {item.type === 'review' ? '⭐' : item.type === 'job_request' ? '📋' : item.type === 'job_accepted' ? '✅' : item.type === 'job_delivered' ? '📦' : item.type === 'job_completed' ? '🎉' : '💬'}
                          </span>
                          <span style={{ fontWeight: 500, color: 'var(--text-primary)', fontSize: 14 }}>
                            {item.type === 'review' ? 'Review' 
                              : item.type === 'job_request' ? 'Job Request'
                              : item.type === 'job_accepted' ? 'Job Accepted'
                              : item.type === 'job_delivered' ? 'Delivery Ready'
                              : item.type === 'job_completed' ? 'Job Complete'
                              : 'Message'}
                          </span>
                          {item.rating && (
                            <span style={{ color: '#fbbf24', fontSize: 12 }}>
                              {'★'.repeat(item.rating)}{'☆'.repeat(5 - item.rating)}
                            </span>
                          )}
                        </div>
                        <div style={{ marginTop: 6 }}>
                          <ResolvedId address={item.senderVerusId} size="sm" showAddress={true} />
                        </div>
                        {item.jobDescription && (
                          <p style={{
                            fontSize: 12,
                            color: 'var(--text-primary)',
                            marginTop: 6,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            fontWeight: 500,
                          }}>
                            {item.jobDescription}
                          </p>
                        )}
                        {item.message && !item.jobDescription && (
                          <p style={{
                            fontSize: 12,
                            color: 'var(--text-secondary)',
                            marginTop: 6,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}>
                            "{item.message}"
                          </p>
                        )}
                      </div>
                      <span className={`badge badge-${item.status}`} style={{ fontSize: 10, flexShrink: 0, marginLeft: 8 }}>
                        {item.status}
                      </span>
                    </div>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                      {new Date(item.createdAt).toLocaleDateString()}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Panel - Details */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-subtle)' }}>
            <h2 className="font-semibold text-white" style={{ fontSize: 14 }}>
              {selectedItem 
                ? (selectedItem.type === 'review' ? 'Review Details' 
                  : selectedItem.jobDetails ? 'Job Progress' 
                  : 'Message Details') 
                : 'Details'}
            </h2>
          </div>
          
          {!selectedItem ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
              <p>Select an item to view details</p>
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
                {/* Job Timeline */}
                {selectedItem.jobDetails ? (
                  <JobTimeline item={selectedItem} />
                ) : (
                  <>
                    {/* Detail rows for reviews */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                      <DetailRow label="Type" value={selectedItem.type} />
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', minWidth: 120 }}>From</span>
                        <ResolvedId address={selectedItem.senderVerusId} size="sm" />
                      </div>
                      {selectedItem.rating && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', minWidth: 120 }}>Rating</span>
                          <span style={{ color: '#fbbf24' }}>
                            {'★'.repeat(selectedItem.rating)}{'☆'.repeat(5 - selectedItem.rating)}
                          </span>
                        </div>
                      )}
                    </div>
                    {selectedItem.message && (
                      <div style={{ marginTop: 20 }}>
                        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Message</span>
                        <p style={{
                          color: 'var(--text-primary)',
                          marginTop: 8,
                          background: 'rgba(255,255,255,0.03)',
                          borderRadius: 8,
                          padding: 16,
                          fontSize: 14,
                          lineHeight: 1.5,
                        }}>
                          "{selectedItem.message}"
                        </p>
                      </div>
                    )}
                  </>
                )}

                {/* Job Action — Accept/View */}
                {selectedItem.jobDetails && selectedItem.type === 'job_request' && selectedItem.jobDetails.status === 'requested' && (
                  <JobAcceptPanel
                    job={selectedItem.jobDetails}
                    onAccepted={() => { fetchInbox(); setSelectedItem(null); }}
                  />
                )}

                {selectedItem.jobDetails && (selectedItem.type !== 'job_request' || selectedItem.jobDetails.status !== 'requested') && (
                  <div style={{ marginTop: 20 }}>
                    <Link
                      to={`/jobs/${selectedItem.jobDetails.id}`}
                      className="btn-primary"
                      style={{ display: 'inline-block', textAlign: 'center' }}
                    >
                      View Job →
                    </Link>
                  </div>
                )}

                {/* Update Command (for reviews) */}
                {selectedItem.type === 'review' && selectedItem.updateCommand && (
                  <div style={{ marginTop: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Update Command</span>
                      <CopyButton text={selectedItem.updateCommand} label="Copy" className="text-verus-blue hover:text-blue-400 text-sm" />
                    </div>
                    <pre style={{
                      background: 'rgba(255,255,255,0.03)',
                      borderRadius: 8,
                      padding: 16,
                      fontSize: 12,
                      color: '#34d399',
                      overflowX: 'auto',
                      fontFamily: 'var(--font-mono)',
                    }}>
                      {selectedItem.updateCommand}
                    </pre>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                      Run this command in your terminal to add the review to your VerusID
                    </p>
                  </div>
                )}

                {/* Next steps callout */}
                {selectedItem.type === 'review' && (
                <div style={{
                  marginTop: 20,
                  background: 'rgba(59, 130, 246, 0.08)',
                  border: '1px solid rgba(59, 130, 246, 0.2)',
                  borderRadius: 8,
                  padding: 16,
                  fontSize: 13,
                }}>
                  <p style={{ color: '#93c5fd', fontWeight: 600 }}>Next steps:</p>
                  <ol style={{ color: '#bfdbfe', marginTop: 8, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <li>Copy the command above</li>
                    <li>Run it in your terminal</li>
                    <li>The review will appear on your profile once confirmed</li>
                  </ol>
                </div>
                )}
              </div>

              {/* Sticky action bar */}
              <div
                style={{
                  padding: '16px 24px',
                  borderTop: '1px solid var(--border-subtle)',
                  background: 'var(--bg-surface)',
                  display: 'flex',
                  gap: 12,
                }}
              >
                {selectedItem.type === 'review' && (
                  <CopyButton
                    text={selectedItem.updateCommand}
                    label="Copy Command"
                    className="btn-primary"
                    variant="pill"
                    style={{ flex: 1 }}
                  />
                )}
                {selectedItem.jobDetails && (
                  <Link
                    to={`/jobs/${selectedItem.jobDetails.id}`}
                    className="btn-primary"
                    style={{ flex: 1, textAlign: 'center' }}
                  >
                    Go to Job
                  </Link>
                )}
                <button
                  onClick={() => rejectItem(selectedItem.id)}
                  className="btn-danger"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, mono }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      padding: '12px 0',
      borderBottom: '1px solid rgba(255,255,255,0.04)',
    }}>
      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', minWidth: 120 }}>{label}</span>
      <span style={{
        fontSize: mono ? 13 : 14,
        fontWeight: 500,
        color: 'var(--text-primary)',
        textAlign: 'right',
        fontFamily: mono ? 'var(--font-mono)' : 'inherit',
      }}>
        {value}
      </span>
    </div>
  );
}
