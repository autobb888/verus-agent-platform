import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ResolvedId from '../components/ResolvedId';
import JobStepper from '../components/JobStepper';
import Chat from '../components/Chat';
import AlertBanner from '../components/AlertBanner';
import JobActions from '../components/JobActions';
import ReviewModal from '../components/ReviewModal';

const API_BASE = import.meta.env.VITE_API_URL || '';

// Status badges now use CSS classes from index.css (badge + badge-{status})

export default function JobDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showReview, setShowReview] = useState(false);
  const [existingReview, setExistingReview] = useState(null);

  useEffect(() => {
    fetchJob();
  }, [id]);

  async function fetchJob() {
    try {
      const res = await fetch(`${API_BASE}/v1/jobs/${id}`, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Failed to fetch job');
      setJob(data.data);
      
      // Check for existing review on this job
      if (data.data?.jobHash) {
        try {
          const reviewRes = await fetch(`${API_BASE}/v1/reviews/job/${data.data.jobHash}`);
          const reviewData = await reviewRes.json();
          if (reviewRes.ok && reviewData.data?.length > 0) {
            setExistingReview(reviewData.data[0]);
          }
        } catch { /* no review yet */ }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-verus-blue mx-auto"></div>
      </div>
    );
  }

  if (error && !job) {
    return (
      <div className="bg-red-900/50 border border-red-700 rounded-lg p-4 text-red-300">
        {error}
      </div>
    );
  }

  if (!job) return null;

  const isBuyer = job.buyerVerusId === user?.verusId;
  const isSeller = job.sellerVerusId === user?.verusId;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Safety Alerts (buyers only) */}
      {isBuyer && <AlertBanner jobId={id} />}

      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/jobs" className="text-gray-400 hover:text-white">
          ← Back
        </Link>
        <span className={`badge badge-${job.status}`}>
          {job.status.replace('_', ' ')}
        </span>
      </div>

      {/* Job Progress Stepper */}
      <div className="card" style={{ padding: '16px 24px' }}>
        <JobStepper status={job.status} hasPayment={!!job.payment?.txid} />
      </div>

      {/* Job Info */}
      <div className="card space-y-4">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-xl font-bold text-white">{job.description}</h1>
            <p className="text-gray-400 mt-1">
              Job #{job.jobHash.slice(0, 8)}...
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-verus-blue">
              {job.amount} {job.currency}
            </p>
            <p className="text-gray-500 text-sm">
              {job.payment.terms}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-700">
          <div>
            <p className="text-gray-500 text-sm mb-1">Buyer</p>
            <ResolvedId address={job.buyerVerusId} size="sm" />
          </div>
          <div>
            <p className="text-gray-500 text-sm mb-1">Seller</p>
            <ResolvedId address={job.sellerVerusId} size="sm" />
          </div>
        </div>

        {/* Payment Status */}
        <div className="bg-gray-900 rounded-lg p-4">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-gray-400 text-sm">Payment Status</p>
              <p className="text-white">
                {job.payment.txid ? (
                  <span className="text-green-400">✓ Paid ({job.payment.txid.slice(0, 16)}...)</span>
                ) : (
                  <span className="text-yellow-400">Pending</span>
                )}
              </p>
            </div>
            {job.payment.address && (
              <div className="text-right">
                <p className="text-gray-400 text-sm">Pay to</p>
                <p className="text-white font-mono text-xs">{job.payment.address}</p>
              </div>
            )}
          </div>
        </div>

        {/* Delivery */}
        {job.delivery && (
          <div className="bg-gray-900 rounded-lg p-4">
            <p className="text-gray-400 text-sm mb-2">Delivery</p>
            <p className="text-white break-all font-mono text-sm">{job.delivery.hash}</p>
            {job.delivery.message && (
              <p className="text-gray-300 mt-2">{job.delivery.message}</p>
            )}
          </div>
        )}

        {/* Timeline */}
        <div className="pt-4 border-t border-gray-700">
          <p className="text-gray-400 text-sm mb-2">Timeline</p>
          <div className="space-y-1 text-sm">
            <p className="text-gray-300">
              <span className="text-gray-500">Requested:</span> {new Date(job.timestamps.requested).toLocaleString()}
            </p>
            {job.timestamps.accepted && (
              <p className="text-gray-300">
                <span className="text-gray-500">Accepted:</span> {new Date(job.timestamps.accepted).toLocaleString()}
              </p>
            )}
            {job.timestamps.delivered && (
              <p className="text-gray-300">
                <span className="text-gray-500">Delivered:</span> {new Date(job.timestamps.delivered).toLocaleString()}
              </p>
            )}
            {job.timestamps.completed && (
              <p className="text-gray-300">
                <span className="text-gray-500">Completed:</span> {new Date(job.timestamps.completed).toLocaleString()}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Job Actions */}
      {(isBuyer || isSeller) && (
        <div className="card">
          <JobActions job={job} onUpdate={fetchJob} />
        </div>
      )}

      {/* Real-time Chat */}
      {(isBuyer || isSeller) && job.status !== 'cancelled' && (
        <Chat jobId={id} job={job} onJobStatusChanged={() => fetchJob()} />
      )}

      {/* Review Section — shown when job is completed */}
      {job.status === 'completed' && (
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4">Review</h3>
          {existingReview ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-yellow-400 text-lg">
                  {'★'.repeat(existingReview.rating)}{'☆'.repeat(5 - existingReview.rating)}
                </span>
                <span className="text-gray-400 text-sm">
                  {existingReview.rating}/5
                </span>
              </div>
              {existingReview.message && (
                <p className="text-gray-300">{existingReview.message}</p>
              )}
              <p className="text-gray-500 text-xs">
                Reviewed by <ResolvedId verusId={existingReview.buyerVerusId || existingReview.buyer_verus_id} />
              </p>
            </div>
          ) : isBuyer ? (
            <button
              onClick={() => setShowReview(true)}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-6 py-3 rounded-lg transition-colors"
            >
              ⭐ Leave a Review
            </button>
          ) : (
            <p className="text-gray-500">No review yet</p>
          )}
        </div>
      )}

      {/* Review Modal */}
      {showReview && (
        <ReviewModal
          job={job}
          onClose={() => setShowReview(false)}
          onSubmitted={() => fetchJob()}
        />
      )}
    </div>
  );
}
