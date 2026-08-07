import { LIFECYCLE_STAGES, LIFECYCLE_LABELS } from '../api/tickets.js';

export default function LifecycleStrip({ tickets, activeStage, onSelect }) {
  const counts = LIFECYCLE_STAGES.reduce((acc, stage) => {
    acc[stage] = tickets.filter((t) => t.lifecycleStage === stage).length;
    return acc;
  }, {});

  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
      {LIFECYCLE_STAGES.map((stage) => (
        <button
          key={stage}
          onClick={() => onSelect(activeStage === stage ? null : stage)}
          style={{
            flex: 1,
            minWidth: 90,
            textAlign: 'center',
            background: 'var(--surface)',
            border: activeStage === stage ? '1px solid var(--accent)' : '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: '8px 4px',
            cursor: 'pointer',
            color: 'var(--text)',
          }}
        >
          <div style={{ fontSize: 17, fontWeight: 700 }}>{counts[stage]}</div>
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>
            {LIFECYCLE_LABELS[stage]}
          </div>
        </button>
      ))}
    </div>
  );
}
