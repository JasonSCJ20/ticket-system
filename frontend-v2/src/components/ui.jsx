export function Card({ title, right, children, style }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 14, marginBottom: 12, ...style }}>
      {title && (
        <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{title}</span>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

export function KpiRow({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>{children}</div>;
}

export function Kpi({ label, value, delta, deltaColor }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px' }}>
      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      {delta && <div style={{ fontSize: 11, marginTop: 4, color: deltaColor || 'var(--text-muted)' }}>{delta}</div>}
    </div>
  );
}

const BADGE_COLORS = {
  critical: ['var(--danger)', 'var(--danger-soft)'],
  high: ['var(--warning)', 'var(--warning-soft)'],
  medium: ['var(--accent)', 'var(--accent-soft)'],
  low: ['var(--text-muted)', 'var(--surface-2)'],
  ok: ['var(--success)', 'var(--success-soft)'],
  'high-risk': ['var(--danger)', 'var(--danger-soft)'],
  watch: ['var(--warning)', 'var(--warning-soft)'],
  controlled: ['var(--success)', 'var(--success-soft)'],
};

export function Badge({ tone = 'medium', children }) {
  const [color, bg] = BADGE_COLORS[tone] || BADGE_COLORS.medium;
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 700, color, background: bg }}>
      {children}
    </span>
  );
}

export function EmptyState({ children }) {
  return <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{children}</p>;
}

// Consistent success/error banner for pages that perform actions — pairs
// with the useActionFeedback hook. Shows every validation-error line when
// there's more than one, instead of only the first.
export function FeedbackBanner({ feedback, onDismiss }) {
  if (!feedback) return null;
  const isOk = feedback.tone === 'ok';
  return (
    <div
      style={{
        marginBottom: 12,
        padding: '10px 12px',
        borderRadius: 8,
        fontSize: 12.5,
        background: isOk ? 'var(--success-soft)' : 'var(--danger-soft)',
        color: isOk ? 'var(--success)' : 'var(--danger)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 10,
      }}
    >
      <div>
        <div>{feedback.text}</div>
        {feedback.details && (
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {feedback.details.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        )}
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 14, lineHeight: 1, opacity: 0.7 }}
        >
          ×
        </button>
      )}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  // A 428 here always means the signed-in account hasn't completed its
  // profile yet — retrying the same request will just 428 again, so point
  // the user at Settings (the one place that fixes it) instead of a
  // dead-end "Retry" button.
  const needsProfile = error?.status === 428 || error?.body?.profileCompletionRequired;
  return (
    <div style={{ fontSize: 12.5, color: 'var(--danger)', background: 'var(--danger-soft)', padding: '10px 12px', borderRadius: 8 }}>
      {needsProfile ? 'Your profile needs to be completed before this page can load.' : error?.message || 'Something went wrong.'}
      {needsProfile ? (
        <a href="/settings" style={{ marginLeft: 10, color: 'var(--danger)', textDecoration: 'underline', fontSize: 12 }}>
          Go to Settings
        </a>
      ) : (
        onRetry && (
          <button onClick={onRetry} style={{ marginLeft: 10, background: 'none', border: 'none', color: 'var(--danger)', textDecoration: 'underline', cursor: 'pointer', fontSize: 12 }}>
            Retry
          </button>
        )
      )}
    </div>
  );
}
