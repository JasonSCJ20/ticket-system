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

const STATUS_DOT_COLORS = {
  ok: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  muted: 'var(--text-muted)',
};

// A single colored dot used as the leading glance-indicator on list rows
// (assets, findings, tickets) — one shared shape so "healthy vs needs
// attention vs down" reads identically everywhere in the app.
export function StatusDot({ tone = 'muted', size = 8 }) {
  return <span style={{ display: 'inline-block', width: size, height: size, borderRadius: '50%', background: STATUS_DOT_COLORS[tone] || STATUS_DOT_COLORS.muted, flexShrink: 0 }} />;
}

// A small tag naming a real entity (an asset, a team) — used wherever a row
// needs to show "this belongs to X" without a full column of table text.
export function Chip({ children, tone = 'accent' }) {
  const palette = {
    accent: ['var(--accent)', 'var(--accent-soft)'],
    muted: ['var(--text-muted)', 'var(--surface-2)'],
  };
  const [color, bg] = palette[tone] || palette.accent;
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: 11, color, background: bg }}>
      {children}
    </span>
  );
}

// One row in a plain-language list (assets, team members, patch tasks) —
// a status dot, a title/subtitle pair, and right-aligned content. Optional
// onClick makes the whole row a pressable list item.
export function StatusRow({ tone, title, subtitle, right, onClick, divider = true }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 4px',
        borderTop: divider ? '1px solid var(--border)' : 'none',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      {tone && <StatusDot tone={tone} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 14, margin: 0 }}>{title}</p>
        {subtitle && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>{subtitle}</p>}
      </div>
      {right && <div style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{right}</div>}
    </div>
  );
}

// A summary tile for KPI-style numbers — lighter weight than the existing
// bordered Kpi component, used on the newer plain-language pages (Overview,
// the redesigned Tickets/Findings/Patches/Reports tabs).
export function StatCard({ label, value, tone }) {
  const color = { ok: 'var(--success)', warning: 'var(--warning)', danger: 'var(--danger)' }[tone];
  return (
    <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius)', padding: '1rem' }}>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 4px' }}>{label}</p>
      <p style={{ fontSize: 24, fontWeight: 500, margin: 0, color: color || 'var(--text)' }}>{value}</p>
    </div>
  );
}

export function StatCardRow({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 24 }}>{children}</div>;
}

// A vertical connector-dot timeline — used for the Tickets tab's "every
// touch on this ticket" progress log, built from real TicketHistory rows.
export function Timeline({ items }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {items.map((item, i) => (
        <div key={i} style={{ display: 'flex', gap: 10, paddingBottom: i === items.length - 1 ? 0 : 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <StatusDot tone={item.tone || 'muted'} size={7} />
            {i < items.length - 1 && <div style={{ width: 1, flex: 1, background: 'var(--border)', marginTop: 2 }} />}
          </div>
          <div>
            <p style={{ fontSize: 12.5, margin: 0 }}>{item.text}</p>
            <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '2px 0 0' }}>{item.when}</p>
          </div>
        </div>
      ))}
    </div>
  );
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
