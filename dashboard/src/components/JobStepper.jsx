const STEPS = ['requested', 'accepted', 'funded', 'delivered', 'completed'];
const STEP_LABELS = ['Requested', 'Accepted', 'Funded', 'Delivered', 'Completed'];

function getStepIndex(status, hasPayment) {
  // Map statuses to step positions
  const map = {
    requested: 0,
    accepted: 1,
    in_progress: hasPayment ? 2 : 1,
    delivered: 3,
    completed: 4,
    disputed: -1,
    cancelled: -1,
  };
  return map[status] ?? 0;
}

export default function JobStepper({ status, hasPayment = false }) {
  const isError = status === 'disputed' || status === 'cancelled';
  const currentIndex = getStepIndex(status, hasPayment);

  // For error states, figure out where we were
  let errorAtIndex = 0;
  if (isError) {
    // Best guess: if has payment, was at funded stage; otherwise check timestamps later
    if (hasPayment) errorAtIndex = 2;
    else errorAtIndex = 1;
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, padding: '4px 0' }}>
      {STEPS.map((step, i) => {
        const isCompleted = !isError && i < currentIndex;
        const isCurrent = !isError && i === currentIndex;
        const isErrorStep = isError && i === errorAtIndex;
        const isPast = isError && i < errorAtIndex;

        let dotColor = 'rgba(255,255,255,0.1)';
        let dotShadow = 'none';
        let connectorColor = 'rgba(255,255,255,0.08)';
        let labelColor = 'var(--text-muted)';

        if (isCompleted || isPast) {
          dotColor = '#34d399';
          connectorColor = '#34d399';
          labelColor = 'var(--text-secondary)';
        }
        if (isCurrent) {
          dotColor = '#fbbf24';
          dotShadow = '0 0 8px rgba(251, 191, 36, 0.4)';
          labelColor = '#fbbf24';
        }
        if (isErrorStep) {
          dotColor = '#ef4444';
          dotShadow = '0 0 8px rgba(239, 68, 68, 0.3)';
          labelColor = '#ef4444';
        }

        return (
          <div key={step} style={{ display: 'flex', alignItems: 'center' }}>
            {/* Connector (before dot, except first) */}
            {i > 0 && (
              <div
                style={{
                  width: 20,
                  height: 2,
                  background: (isCompleted || isPast) ? '#34d399' : 'rgba(255,255,255,0.08)',
                  transition: 'background 0.3s',
                }}
              />
            )}
            {/* Step */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: dotColor,
                  boxShadow: dotShadow,
                  transition: 'all 0.3s',
                }}
              />
              <span
                style={{
                  fontSize: 10,
                  fontWeight: (isCurrent || isErrorStep) ? 600 : 400,
                  color: labelColor,
                  whiteSpace: 'nowrap',
                }}
              >
                {isErrorStep ? (status === 'disputed' ? 'Disputed' : 'Cancelled') : STEP_LABELS[i]}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
