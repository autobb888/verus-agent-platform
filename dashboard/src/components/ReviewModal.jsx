import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';

const API_BASE = import.meta.env.VITE_API_URL || '';

const STAR_LABELS = ['Terrible', 'Poor', 'Okay', 'Good', 'Excellent'];

export default function ReviewModal({ job, onClose, onSubmitted }) {
  const { user } = useAuth();
  const addToast = useToast();
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [message, setMessage] = useState('');
  const [step, setStep] = useState('compose'); // compose | sign | submitting | done | error
  const [signData, setSignData] = useState(null);
  const [signature, setSignature] = useState('');
  const [error, setError] = useState(null);

  const modalRef = useRef(null);

  const agentVerusId = job.seller?.verusId || job.sellerVerusId;
  const shortName = user?.identityName || user?.verusId;

  // Focus trap (F-22)
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key !== 'Tab' || !modalRef.current) return;
    const focusable = modalRef.current.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  async function handleGetSignMessage() {
    if (rating < 1 || rating > 5) {
      setError('Please select a rating');
      return;
    }

    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const params = new URLSearchParams({
        agentVerusId,
        jobHash: job.jobHash,
        message: message || '',
        rating: String(rating),
        timestamp: String(timestamp),
      });

      const res = await fetch(`${API_BASE}/v1/reviews/message?${params}`, {
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Failed to get sign message');

      setSignData({
        message: data.data.message,
        timestamp: data.data.timestamp,
      });
      setStep('sign');
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSubmit() {
    if (!signature.trim()) {
      setError('Please paste your signature');
      return;
    }

    setStep('submitting');
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/v1/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          agentVerusId,
          buyerVerusId: user.verusId,
          jobHash: job.jobHash,
          message: message || '',
          rating,
          timestamp: signData.timestamp,
          signature: signature.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Failed to submit review');

      setStep('done');
      addToast?.('Review submitted!');
      setTimeout(() => {
        onSubmitted?.();
        onClose();
      }, 2000);
    } catch (err) {
      setError(err.message);
      setStep('sign');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div ref={modalRef} role="dialog" aria-modal="true" aria-label="Leave a Review" className="bg-[#1a1a2e] border border-white/10 rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-lg font-semibold text-white">Leave a Review</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl" aria-label="Close">✕</button>
        </div>

        <div className="p-6 space-y-5">
          {step === 'compose' && (
            <>
              {/* Star Rating */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">Rating</label>
                <div className="flex gap-2 items-center">
                  {[1, 2, 3, 4, 5].map(star => (
                    <button
                      key={star}
                      onMouseEnter={() => setHoverRating(star)}
                      onMouseLeave={() => setHoverRating(0)}
                      onClick={() => setRating(star)}
                      className="text-3xl transition-transform hover:scale-110"
                    >
                      {star <= (hoverRating || rating) ? '★' : '☆'}
                    </button>
                  ))}
                  {(hoverRating || rating) > 0 && (
                    <span className="text-sm text-gray-400 ml-2">
                      {STAR_LABELS[(hoverRating || rating) - 1]}
                    </span>
                  )}
                </div>
              </div>

              {/* Review Text */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">Review (optional)</label>
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder="How was your experience?"
                  rows={3}
                  maxLength={500}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none"
                />
                <div className="text-xs text-gray-400 text-right mt-1">{message.length}/500</div>
              </div>

              <button
                onClick={handleGetSignMessage}
                disabled={rating < 1}
                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-medium py-3 rounded-lg transition-colors"
              >
                Continue to Sign
              </button>
            </>
          )}

          {step === 'sign' && signData && (
            <>
              {/* Sign Command */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  Sign this message with your VerusID
                </label>
                <div className="bg-black/40 border border-white/10 rounded-lg p-3">
                  <code className="text-xs text-green-400 break-all select-all">
                    verus -testnet signmessage "{shortName}" "{signData.message}"
                  </code>
                </div>
                <button
                  onClick={() => navigator.clipboard.writeText(`verus -testnet signmessage "${shortName}" "${signData.message}"`)}
                  className="text-xs text-indigo-400 hover:text-indigo-300 mt-2"
                >
                  📋 Copy command
                </button>
              </div>

              {/* Signature Input */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">Paste signature</label>
                <input
                  type="text"
                  value={signature}
                  onChange={e => setSignature(e.target.value)}
                  placeholder="Paste the signature output here..."
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 font-mono text-sm"
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => { setStep('compose'); setSignData(null); setSignature(''); }}
                  className="flex-1 bg-white/5 hover:bg-white/10 text-gray-300 font-medium py-3 rounded-lg transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={!signature.trim()}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-medium py-3 rounded-lg transition-colors"
                >
                  Submit Review
                </button>
              </div>
            </>
          )}

          {step === 'submitting' && (
            <div className="text-center py-8">
              <div className="animate-spin text-3xl mb-3">⏳</div>
              <p className="text-gray-400">Verifying signature and submitting review...</p>
            </div>
          )}

          {step === 'done' && (
            <div className="text-center py-8">
              <div className="text-4xl mb-3">✅</div>
              <p className="text-white font-medium">Review submitted!</p>
              <p className="text-gray-400 text-sm mt-1">Thank you for your feedback</p>
            </div>
          )}

          {error && (
            <div id="review-form-error" role="alert" className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
