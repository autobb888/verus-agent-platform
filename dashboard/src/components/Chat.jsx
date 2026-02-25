import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import Markdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import ResolvedId from './ResolvedId';
import CopyButton from './CopyButton';
import { useDisplayName } from '../context/IdentityContext';
import { useAuth } from '../context/AuthContext';
import HeldMessageIndicator from './HeldMessageIndicator';
import SafetyScanBadge from './SafetyScanBadge';

const API_BASE = import.meta.env.VITE_API_URL || '';

function TypingName({ verusId }) {
  const name = useDisplayName(verusId);
  return <span>{name}</span>;
}
const WS_URL = import.meta.env.VITE_WS_URL || window.location.origin;

/**
 * Build a signmessage command — single-line format, works in CLI and GUI console.
 */
function buildSignCmd(idName, message) {
  return `signmessage "${idName}" "${message.replace(/"/g, '\\"')}"`;
}

const STAR_LABELS = ['Terrible', 'Poor', 'Okay', 'Good', 'Excellent'];

export default function Chat({ jobId, job, onJobStatusChanged }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [connected, setConnected] = useState(false);
  const [typingUser, setTypingUser] = useState(null);
  const [readReceipts, setReadReceipts] = useState({});
  const [expanded, setExpanded] = useState(false);
  const [heldMessages, setHeldMessages] = useState([]);
  const [peerOnline, setPeerOnline] = useState(false);
  const [sessionWarning, setSessionWarning] = useState(null);
  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const lastTypingSentRef = useRef(0);

  // End-session state
  const [jobStatus, setJobStatus] = useState(job?.status);
  const [endSessionPanel, setEndSessionPanel] = useState(null);
  // null | 'deliver' | 'complete' | 'review' | 'done'
  const [sessionEndingInfo, setSessionEndingInfo] = useState(null);
  // { requestedBy, reason } — from WS event
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState(null);

  // Delivery panel state
  const [deliveryMsg, setDeliveryMsg] = useState('');
  const [deliverySig, setDeliverySig] = useState('');

  // Complete panel state
  const [completeSig, setCompleteSig] = useState('');

  // Review panel state
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewHover, setReviewHover] = useState(0);
  const [reviewMessage, setReviewMessage] = useState('');
  const [reviewSignData, setReviewSignData] = useState(null);
  const [reviewSig, setReviewSig] = useState('');
  const [reviewStep, setReviewStep] = useState('compose'); // compose | sign | submitting

  // Extension panel state
  const [extAmount, setExtAmount] = useState('');
  const [extReason, setExtReason] = useState('');

  const isBuyer = job?.buyerVerusId === user?.verusId;
  const isSeller = job?.sellerVerusId === user?.verusId;

  // Sync job status from prop
  useEffect(() => {
    if (job?.status) setJobStatus(job.status);
  }, [job?.status]);

  // Auto-scroll
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Load initial messages via REST
  useEffect(() => {
    async function loadMessages() {
      try {
        const res = await fetch(`${API_BASE}/v1/jobs/${jobId}/messages`, { credentials: 'include' });
        const data = await res.json();
        if (res.ok && data.data) {
          setMessages(data.data);
        }
      } catch { /* ignore */ }
    }
    loadMessages();
  }, [jobId]);

  // Socket.IO connection (get chat token first, then connect)
  useEffect(() => {
    let socket;
    let cancelled = false;

    async function connectChat() {
      // Get one-time chat token via REST API
      try {
        const tokenRes = await fetch(`${API_BASE}/v1/chat/token`, { credentials: 'include' });
        if (!tokenRes.ok) {
          console.warn('[Chat] Failed to get chat token:', tokenRes.status);
          return;
        }
        const tokenData = await tokenRes.json();
        const chatToken = tokenData.data?.token;
        if (!chatToken || cancelled) return;

        socket = io(WS_URL, {
          path: '/ws',
          auth: { token: chatToken },
          withCredentials: true,
          transports: ['websocket', 'polling'],
        });
      } catch (err) {
        console.warn('[Chat] Error getting chat token:', err);
        return;
      }
      if (cancelled) { socket?.disconnect(); return; }
      socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join_job', { jobId });
    });

    socket.on('disconnect', () => setConnected(false));

    socket.on('message', (msg) => {
      setMessages(prev => {
        // Deduplicate
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    });

    socket.on('typing', (data) => {
      if (data.verusId !== user?.verusId) {
        setTypingUser(data.verusId);
        // Clear after 3s
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => setTypingUser(null), 3000);
      }
    });

    socket.on('message_held', (data) => {
      setHeldMessages(prev => [...prev, { id: data.id || Date.now(), timestamp: Date.now() }]);
    });

    socket.on('read', (data) => {
      setReadReceipts(prev => ({ ...prev, [data.verusId]: data.readAt }));
    });

    socket.on('error', (err) => {
      console.warn('[Chat] Socket error:', err.message);
    });

    socket.on('user_joined', (data) => {
      if (data.verusId !== user?.verusId) {
        setPeerOnline(true);
      }
    });

    socket.on('user_left', (data) => {
      if (data.verusId !== user?.verusId) {
        setPeerOnline(false);
      }
    });

    socket.on('session_expiring', (data) => {
      setSessionWarning(`Session expires in ${data.remainingSeconds}s`);
      setTimeout(() => setSessionWarning(null), 30000);
    });

    // End-session WS listeners
    socket.on('session_ending', (data) => {
      setSessionEndingInfo({ requestedBy: data.requestedBy, reason: data.reason });
    });

    socket.on('job_status_changed', (data) => {
      setJobStatus(data.status);
      onJobStatusChanged?.();
      // Auto-open relevant panel for buyer
      if (data.status === 'delivered' && isBuyer) {
        setEndSessionPanel(null); // Let them see the delivered banner
      }
      if (data.status === 'completed') {
        setEndSessionPanel('done');
      }
    });

    } // end connectChat

    connectChat();

    return () => {
      cancelled = true;
      if (socketRef.current) {
        socketRef.current.emit('leave_job', { jobId });
        socketRef.current.disconnect();
      }
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, [jobId, user?.verusId]);

  // Send read receipt when viewing messages
  useEffect(() => {
    if (connected && messages.length > 0 && socketRef.current) {
      socketRef.current.emit('read', { jobId });
    }
  }, [messages.length, connected, jobId]);

  function handleSend(e) {
    e.preventDefault();
    const content = input.trim();
    if (!content || !socketRef.current || !connected) return;

    socketRef.current.emit('message', { jobId, content });
    setInput('');
  }

  function handleInputChange(e) {
    setInput(e.target.value);
    // Send typing indicator (throttled to once per 2s)
    const now = Date.now();
    if (socketRef.current && connected && now - lastTypingSentRef.current > 2000) {
      socketRef.current.emit('typing', { jobId });
      lastTypingSentRef.current = now;
    }
  }

  // API actions
  async function handleEndSession() {
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`${API_BASE}/v1/jobs/${jobId}/end-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reason: 'user_requested' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Failed to request end session');
      // After signaling, open appropriate panel
      if (isSeller) {
        setEndSessionPanel('deliver');
      } else {
        // Buyer just signals — seller needs to deliver first
        setSessionEndingInfo({ requestedBy: user?.verusId, reason: 'user_requested' });
      }
    } catch (err) {
      setActionError(err.message);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDeliver() {
    setActionLoading(true);
    setActionError(null);
    try {
      const ts = Math.floor(Date.now() / 1000);
      const res = await fetch(`${API_BASE}/v1/jobs/${jobId}/deliver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          deliveryHash: 'pending',
          deliveryMessage: deliveryMsg || undefined,
          timestamp: ts,
          signature: deliverySig.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Delivery failed');
      setEndSessionPanel(null);
      setDeliveryMsg('');
      setDeliverySig('');
      onJobStatusChanged?.();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleComplete() {
    setActionLoading(true);
    setActionError(null);
    try {
      const ts = Math.floor(Date.now() / 1000);
      const res = await fetch(`${API_BASE}/v1/jobs/${jobId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          timestamp: ts,
          signature: completeSig.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Completion failed');
      setCompleteSig('');
      setEndSessionPanel('review');
      onJobStatusChanged?.();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleGetReviewSignMessage() {
    if (reviewRating < 1) {
      setActionError('Please select a rating');
      return;
    }
    setActionLoading(true);
    setActionError(null);
    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const agentVerusId = job.sellerVerusId;
      const params = new URLSearchParams({
        agentVerusId,
        jobHash: job.jobHash,
        message: reviewMessage || '',
        rating: String(reviewRating),
        timestamp: String(timestamp),
      });
      const res = await fetch(`${API_BASE}/v1/reviews/message?${params}`, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Failed to get sign message');
      setReviewSignData({ message: data.data.message, timestamp: data.data.timestamp });
      setReviewStep('sign');
    } catch (err) {
      setActionError(err.message);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSubmitReview() {
    if (!reviewSig.trim()) {
      setActionError('Please paste your signature');
      return;
    }
    setActionLoading(true);
    setActionError(null);
    setReviewStep('submitting');
    try {
      const res = await fetch(`${API_BASE}/v1/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          agentVerusId: job.sellerVerusId,
          buyerVerusId: user.verusId,
          jobHash: job.jobHash,
          message: reviewMessage || '',
          rating: reviewRating,
          timestamp: reviewSignData.timestamp,
          signature: reviewSig.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Failed to submit review');
      setEndSessionPanel('done');
      onJobStatusChanged?.();
    } catch (err) {
      setActionError(err.message);
      setReviewStep('sign');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRequestExtension() {
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`${API_BASE}/v1/jobs/${jobId}/extensions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ amount: Number(extAmount), reason: extReason || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Failed to request extension');
      setEndSessionPanel(null);
      setSessionEndingInfo(null);
      setExtAmount('');
      setExtReason('');
      onJobStatusChanged?.();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setActionLoading(false);
    }
  }

  const height = expanded ? '600px' : '400px';
  const idName = user?.identityName ? `${user.identityName}@` : 'yourID@';
  const isSessionDone = endSessionPanel === 'done' || (jobStatus === 'completed' && !endSessionPanel);
  const inputDisabled = isSessionDone;

  // Render the action bar content based on current state
  function renderActionBar() {
    // Done state
    if (endSessionPanel === 'done') {
      return (
        <div style={{
          padding: '12px 16px', background: 'rgba(34, 197, 94, 0.1)',
          borderTop: '1px solid rgba(34, 197, 94, 0.3)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ color: '#22c55e', fontSize: 16 }}>&#10003;</span>
          <span style={{ color: '#22c55e', fontWeight: 600, fontSize: 14 }}>Session Complete</span>
        </div>
      );
    }

    // Review panel (after completion, buyer only)
    if (endSessionPanel === 'review' && isBuyer) {
      return (
        <div style={{
          padding: '12px 16px', background: 'var(--bg-tertiary)',
          borderTop: '1px solid var(--border-primary)',
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
            Leave a Review
          </div>

          {reviewStep === 'compose' && (
            <>
              <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                {[1, 2, 3, 4, 5].map(star => (
                  <button
                    key={star}
                    onMouseEnter={() => setReviewHover(star)}
                    onMouseLeave={() => setReviewHover(0)}
                    onClick={() => setReviewRating(star)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: 24, color: star <= (reviewHover || reviewRating) ? '#eab308' : '#4b5563',
                    }}
                  >
                    {star <= (reviewHover || reviewRating) ? '\u2605' : '\u2606'}
                  </button>
                ))}
                {(reviewHover || reviewRating) > 0 && (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8, alignSelf: 'center' }}>
                    {STAR_LABELS[(reviewHover || reviewRating) - 1]}
                  </span>
                )}
              </div>
              <textarea
                value={reviewMessage}
                onChange={e => setReviewMessage(e.target.value)}
                placeholder="How was your experience? (optional)"
                rows={2}
                maxLength={500}
                style={{
                  width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
                  borderRadius: 6, padding: '6px 10px', color: 'var(--text-primary)', fontSize: 13,
                  resize: 'none', outline: 'none',
                }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  onClick={handleGetReviewSignMessage}
                  disabled={reviewRating < 1 || actionLoading}
                  className="btn-primary"
                  style={{ padding: '6px 14px', fontSize: 13 }}
                >
                  {actionLoading ? 'Loading...' : 'Continue to Sign'}
                </button>
                <button
                  onClick={() => setEndSessionPanel('done')}
                  style={{
                    background: 'none', border: '1px solid var(--border-primary)',
                    borderRadius: 6, padding: '6px 14px', fontSize: 13,
                    color: 'var(--text-muted)', cursor: 'pointer',
                  }}
                >
                  Skip
                </button>
              </div>
            </>
          )}

          {reviewStep === 'sign' && reviewSignData && (
            <>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                Sign this with your VerusID:
              </p>
              <div style={{
                background: 'var(--bg-secondary)', borderRadius: 6, padding: 8,
                fontFamily: 'monospace', fontSize: 11, color: '#3b82f6',
                wordBreak: 'break-all', whiteSpace: 'pre-wrap', marginBottom: 8,
              }}>
                {buildSignCmd(idName, reviewSignData.message)}
              </div>
              <CopyButton text={buildSignCmd(idName, reviewSignData.message)} label="Copy command" />
              <input
                type="text"
                value={reviewSig}
                onChange={e => setReviewSig(e.target.value)}
                placeholder="Paste signature..."
                style={{
                  width: '100%', marginTop: 8, background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-primary)', borderRadius: 6,
                  padding: '6px 10px', color: 'var(--text-primary)', fontFamily: 'monospace',
                  fontSize: 13, outline: 'none',
                }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  onClick={handleSubmitReview}
                  disabled={!reviewSig.trim() || actionLoading}
                  className="btn-primary"
                  style={{ padding: '6px 14px', fontSize: 13 }}
                >
                  {actionLoading ? 'Submitting...' : 'Submit Review'}
                </button>
                <button
                  onClick={() => { setReviewStep('compose'); setReviewSignData(null); setReviewSig(''); }}
                  style={{
                    background: 'none', border: '1px solid var(--border-primary)',
                    borderRadius: 6, padding: '6px 14px', fontSize: 13,
                    color: 'var(--text-muted)', cursor: 'pointer',
                  }}
                >
                  Back
                </button>
              </div>
            </>
          )}

          {reviewStep === 'submitting' && (
            <div style={{ textAlign: 'center', padding: '12px 0', color: 'var(--text-muted)', fontSize: 13 }}>
              Verifying and submitting review...
            </div>
          )}
        </div>
      );
    }

    // Completion panel (buyer, job delivered)
    if (endSessionPanel === 'complete' && isBuyer) {
      const ts = Math.floor(Date.now() / 1000);
      const msg = `VAP-COMPLETE|Job:${job.jobHash}|Ts:${ts}|I confirm the work has been delivered satisfactorily.`;
      const cmd = buildSignCmd(idName, msg);

      return (
        <div style={{
          padding: '12px 16px', background: 'var(--bg-tertiary)',
          borderTop: '1px solid var(--border-primary)',
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
            Confirm Completion
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
            Sign this to confirm you received satisfactory work:
          </p>
          <div style={{
            background: 'var(--bg-secondary)', borderRadius: 6, padding: 8,
            fontFamily: 'monospace', fontSize: 11, color: '#3b82f6',
            wordBreak: 'break-all', whiteSpace: 'pre-wrap', marginBottom: 8,
          }}>
            {cmd}
          </div>
          <CopyButton text={cmd} label="Copy command" />
          <input
            type="text"
            value={completeSig}
            onChange={e => setCompleteSig(e.target.value)}
            placeholder="Paste signature..."
            style={{
              width: '100%', marginTop: 8, background: 'var(--bg-secondary)',
              border: '1px solid var(--border-primary)', borderRadius: 6,
              padding: '6px 10px', color: 'var(--text-primary)', fontFamily: 'monospace',
              fontSize: 13, outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              onClick={handleComplete}
              disabled={!completeSig.trim() || actionLoading}
              className="btn-primary"
              style={{ padding: '6px 14px', fontSize: 13 }}
            >
              {actionLoading ? 'Submitting...' : 'Confirm Complete'}
            </button>
            <button
              onClick={() => { setEndSessionPanel(null); setCompleteSig(''); }}
              style={{
                background: 'none', border: '1px solid var(--border-primary)',
                borderRadius: 6, padding: '6px 14px', fontSize: 13,
                color: 'var(--text-muted)', cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      );
    }

    // Delivery panel (seller)
    if (endSessionPanel === 'deliver' && isSeller) {
      const ts = Math.floor(Date.now() / 1000);
      const deliveryHash = 'pending';
      const msg = `VAP-DELIVER|Job:${job.jobHash}|Delivery:${deliveryHash}|Ts:${ts}|I have delivered the work for this job.`;
      const cmd = buildSignCmd(idName, msg);

      return (
        <div style={{
          padding: '12px 16px', background: 'var(--bg-tertiary)',
          borderTop: '1px solid var(--border-primary)',
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
            Mark as Delivered
          </div>
          <textarea
            value={deliveryMsg}
            onChange={e => setDeliveryMsg(e.target.value)}
            placeholder="Delivery message (optional)..."
            rows={2}
            maxLength={1000}
            style={{
              width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
              borderRadius: 6, padding: '6px 10px', color: 'var(--text-primary)', fontSize: 13,
              resize: 'none', outline: 'none', marginBottom: 8,
            }}
          />
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
            Sign this message:
          </p>
          <div style={{
            background: 'var(--bg-secondary)', borderRadius: 6, padding: 8,
            fontFamily: 'monospace', fontSize: 11, color: '#3b82f6',
            wordBreak: 'break-all', whiteSpace: 'pre-wrap', marginBottom: 8,
          }}>
            {cmd}
          </div>
          <CopyButton text={cmd} label="Copy command" />
          <input
            type="text"
            value={deliverySig}
            onChange={e => setDeliverySig(e.target.value)}
            placeholder="Paste signature..."
            style={{
              width: '100%', marginTop: 8, background: 'var(--bg-secondary)',
              border: '1px solid var(--border-primary)', borderRadius: 6,
              padding: '6px 10px', color: 'var(--text-primary)', fontFamily: 'monospace',
              fontSize: 13, outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              onClick={handleDeliver}
              disabled={!deliverySig.trim() || actionLoading}
              className="btn-primary"
              style={{ padding: '6px 14px', fontSize: 13 }}
            >
              {actionLoading ? 'Submitting...' : 'Submit Delivery'}
            </button>
            <button
              onClick={() => { setEndSessionPanel(null); setDeliverySig(''); setDeliveryMsg(''); }}
              style={{
                background: 'none', border: '1px solid var(--border-primary)',
                borderRadius: 6, padding: '6px 14px', fontSize: 13,
                color: 'var(--text-muted)', cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      );
    }

    // Extension panel
    if (endSessionPanel === 'extend') {
      return (
        <div style={{
          padding: '12px 16px', background: 'var(--bg-tertiary)',
          borderTop: '1px solid var(--border-primary)',
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
            Extend Session
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
            Request additional payment to continue the session.
          </p>
          <div style={{ marginBottom: 8 }}>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
              Additional Amount ({job.currency})
            </label>
            <input
              type="number"
              step="0.01"
              min="0.001"
              value={extAmount}
              onChange={e => setExtAmount(e.target.value)}
              placeholder="e.g. 100"
              style={{
                width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
                borderRadius: 6, padding: '6px 10px', color: 'var(--text-primary)', fontSize: 13, outline: 'none',
              }}
            />
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
              Reason (optional)
            </label>
            <textarea
              value={extReason}
              onChange={e => setExtReason(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="e.g. Job requires more tokens..."
              style={{
                width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
                borderRadius: 6, padding: '6px 10px', color: 'var(--text-primary)', fontSize: 13,
                resize: 'none', outline: 'none',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleRequestExtension}
              disabled={!extAmount || Number(extAmount) <= 0 || actionLoading}
              className="btn-primary"
              style={{ padding: '6px 14px', fontSize: 13 }}
            >
              {actionLoading ? 'Submitting...' : 'Request Extension'}
            </button>
            <button
              onClick={() => { setEndSessionPanel(null); setExtAmount(''); setExtReason(''); }}
              style={{
                background: 'none', border: '1px solid var(--border-primary)',
                borderRadius: 6, padding: '6px 14px', fontSize: 13,
                color: 'var(--text-muted)', cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      );
    }

    // --- Banners and action buttons (no panel open) ---

    // Completed state — auto-open review for buyer, show done for seller
    if (jobStatus === 'completed' && !endSessionPanel) {
      if (isBuyer) {
        return (
          <div style={{
            padding: '10px 16px', background: 'rgba(34, 197, 94, 0.1)',
            borderTop: '1px solid rgba(34, 197, 94, 0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#22c55e', fontSize: 14 }}>&#10003;</span>
              <span style={{ color: '#22c55e', fontWeight: 600, fontSize: 13 }}>Job completed</span>
            </div>
            <button
              onClick={() => setEndSessionPanel('review')}
              className="btn-primary"
              style={{ padding: '6px 14px', fontSize: 13 }}
            >
              Leave a Review
            </button>
          </div>
        );
      }
      return (
        <div style={{
          padding: '10px 16px', background: 'rgba(34, 197, 94, 0.1)',
          borderTop: '1px solid rgba(34, 197, 94, 0.3)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ color: '#22c55e', fontSize: 14 }}>&#10003;</span>
          <span style={{ color: '#22c55e', fontWeight: 600, fontSize: 13 }}>Session Complete</span>
        </div>
      );
    }

    // Delivered state — buyer sees "Confirm & Review"
    if (jobStatus === 'delivered') {
      if (isBuyer) {
        return (
          <div style={{
            padding: '10px 16px', background: 'rgba(59, 130, 246, 0.1)',
            borderTop: '1px solid rgba(59, 130, 246, 0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{ color: '#3b82f6', fontWeight: 600, fontSize: 13 }}>
              Work delivered — ready to confirm?
            </span>
            <button
              onClick={() => setEndSessionPanel('complete')}
              className="btn-primary"
              style={{ padding: '6px 14px', fontSize: 13 }}
            >
              Confirm & Review
            </button>
          </div>
        );
      }
      return (
        <div style={{
          padding: '10px 16px', background: 'rgba(59, 130, 246, 0.1)',
          borderTop: '1px solid rgba(59, 130, 246, 0.3)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ color: '#3b82f6', fontWeight: 600, fontSize: 13 }}>
            Delivered — waiting for buyer confirmation
          </span>
        </div>
      );
    }

    // Session ending signal received from other party
    if (jobStatus === 'in_progress' && sessionEndingInfo && sessionEndingInfo.requestedBy !== user?.verusId) {
      return (
        <div style={{
          padding: '10px 16px', background: 'rgba(245, 158, 11, 0.1)',
          borderTop: '1px solid rgba(245, 158, 11, 0.3)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ color: '#f59e0b', fontWeight: 600, fontSize: 13 }}>
              Session ending: {sessionEndingInfo.reason || 'Other party requested end'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setEndSessionPanel('extend')}
              style={{
                background: 'none', border: '1px solid var(--border-primary)',
                borderRadius: 6, padding: '6px 14px', fontSize: 13,
                color: 'var(--text-primary)', cursor: 'pointer',
              }}
            >
              Extend Session
            </button>
            <button
              onClick={() => {
                if (isSeller) {
                  setEndSessionPanel('deliver');
                } else {
                  // Buyer can't complete until seller delivers — signal back
                  handleEndSession();
                }
              }}
              className="btn-primary"
              style={{ padding: '6px 14px', fontSize: 13 }}
            >
              {isSeller ? 'End & Deliver' : 'End & Complete'}
            </button>
          </div>
        </div>
      );
    }

    // In-progress — show end session button
    if (jobStatus === 'in_progress') {
      return (
        <div style={{
          padding: '8px 16px', borderTop: '1px solid var(--border-primary)',
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
        }}>
          <button
            onClick={handleEndSession}
            disabled={actionLoading}
            style={{
              background: 'none', border: '1px solid rgba(239, 68, 68, 0.4)',
              borderRadius: 6, padding: '5px 12px', fontSize: 12,
              color: '#ef4444', cursor: 'pointer',
            }}
          >
            {actionLoading ? 'Ending...' : isSeller ? 'End Session' : 'End Session Early'}
          </button>
        </div>
      );
    }

    return null;
  }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', height, transition: 'height 0.2s' }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '12px 16px', borderBottom: '1px solid var(--border-primary)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>
            Chat
          </h3>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: !connected ? '#ef4444' : peerOnline ? '#22c55e' : '#f59e0b',
            display: 'inline-block',
          }} title={!connected ? 'Disconnected' : peerOnline ? 'Peer online' : 'Peer offline'} />
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            background: 'none', border: 'none', color: 'var(--text-muted)',
            cursor: 'pointer', fontSize: 14,
          }}
        >
          {expanded ? '\u2193 Collapse' : '\u2191 Expand'}
        </button>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '12px 16px',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {messages.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '32px 0' }}>
            No messages yet. Start the conversation!
          </p>
        ) : (
          messages.map((msg) => {
            const isMe = msg.senderVerusId === user?.verusId;
            const isFlagged = msg.safetyScore != null && msg.safetyScore >= 0.4;
            return (
              <div
                key={msg.id}
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  maxWidth: '80%',
                  alignSelf: isMe ? 'flex-end' : 'flex-start',
                  background: isMe ? 'rgba(59, 130, 246, 0.15)' : 'var(--bg-tertiary)',
                  border: isFlagged ? '1px solid #eab308' : '1px solid transparent',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <ResolvedId address={msg.senderVerusId} size="sm" showAddress={false} />
                  {msg.signed && (
                    <span style={{ fontSize: 10, color: '#22c55e' }}>{'\u2713'} signed</span>
                  )}
                  <SafetyScanBadge score={msg.safetyScore} warning={isFlagged} />
                  {isFlagged && (
                    <span style={{ fontSize: 10, color: '#eab308' }}>Flagged</span>
                  )}
                </div>
                <div style={{ margin: 0, color: 'var(--text-primary)', fontSize: 14, wordBreak: 'break-word' }} className="chat-markdown">
                  <Markdown rehypePlugins={[rehypeSanitize]}>{msg.content}</Markdown>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString() : ''}
                  </span>
                  {isMe && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {Object.keys(readReceipts).length > 0 ? '\u2713\u2713' : '\u2713'}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
        {heldMessages.map(h => (
          <HeldMessageIndicator key={h.id} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Session expiry warning */}
      {sessionWarning && (
        <div style={{
          padding: '6px 16px', fontSize: 12, color: '#f59e0b',
          background: 'rgba(245, 158, 11, 0.1)',
          borderTop: '1px solid rgba(245, 158, 11, 0.3)',
        }}>
          {sessionWarning}
        </div>
      )}

      {/* Typing indicator */}
      {typingUser && (
        <div style={{ padding: '4px 16px', fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
          <TypingName verusId={typingUser} /> is typing...
        </div>
      )}

      {/* Action error */}
      {actionError && (
        <div style={{
          padding: '6px 16px', fontSize: 12, color: '#ef4444',
          background: 'rgba(239, 68, 68, 0.1)',
          borderTop: '1px solid rgba(239, 68, 68, 0.3)',
        }}>
          {actionError}
          <button
            onClick={() => setActionError(null)}
            style={{ marginLeft: 8, background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 12 }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* End-session action bar */}
      {renderActionBar()}

      {/* Input */}
      <form
        onSubmit={handleSend}
        style={{
          display: 'flex', gap: 8, padding: '12px 16px',
          borderTop: '1px solid var(--border-primary)',
        }}
      >
        <input
          type="text"
          value={input}
          onChange={handleInputChange}
          placeholder={inputDisabled ? 'Session ended' : 'Type a message...'}
          maxLength={4000}
          disabled={inputDisabled}
          style={{
            flex: 1, background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)',
            borderRadius: 8, padding: '8px 12px', color: 'var(--text-primary)',
            outline: 'none', fontSize: 14,
            opacity: inputDisabled ? 0.5 : 1,
          }}
        />
        <button
          type="submit"
          disabled={!input.trim() || !connected || inputDisabled}
          className="btn-primary"
          style={{ padding: '8px 16px' }}
        >
          Send
        </button>
      </form>
    </div>
  );
}
