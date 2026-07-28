// Horizontal bar breakdown — each row's fill width is proportional to `value`
// against the shared `max`. Used for things like "what's driving this score".
export default function BarBreakdown({ rows, max }) {
  const scaleMax = max ?? Math.max(...rows.map((r) => r.value), 1);
  return (
    <div>
      {rows.map((row) => (
        <div key={row.label} style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 4 }}>
            <span style={{ color: 'var(--text-muted)' }}>{row.label}</span>
            <span style={{ fontWeight: 600 }}>{row.value}</span>
          </div>
          <div style={{ height: 6, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${Math.min(100, (row.value / scaleMax) * 100)}%`,
                background: row.color || 'var(--accent)',
                borderRadius: 4,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
