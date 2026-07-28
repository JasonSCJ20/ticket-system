import { LIFECYCLE_STAGES } from '../api/tickets.js';

const LABELS = {
  identified: 'Identified',
  triaged: 'Triaged',
  contained: 'Contained',
  eradicated: 'Eradicated',
  recovered: 'Recovered',
  postmortem: 'Postmortem',
  closed: 'Closed',
};

export default function LifecycleStrip({ tickets, activeStage, onSelect }) {
  const counts = LIFECYCLE_STAGES.reduce((acc, stage) => {
    acc[stage] = tickets.filter((t) => t.lifecycleStage === stage).length;
    return acc;
  }, {});

  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
      {LIFECYCLE_STAGES.map((stage) => (
        <button
          key={stage}
          onClick={() => onSelect(activeStage === stage ? null : stage)}
          style={{
            flex: 1,
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
          <div style={{ fontSize: 9.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 2 }}>
            {LABELS[stage]}
          </div>
        </button>
      ))}
    </div>
  );
}
