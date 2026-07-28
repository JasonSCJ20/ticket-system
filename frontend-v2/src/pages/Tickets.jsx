import { useState, useMemo } from 'react';
import { useApi } from '../hooks/useApi.js';
import { fetchTickets } from '../api/tickets.js';
import { Card, Badge, ErrorState } from '../components/ui.jsx';
import LifecycleStrip from '../components/LifecycleStrip.jsx';
import TicketDetail from './TicketDetail.jsx';

function slaShortLabel(t) {
  if (!t.slaDueAt) return '—';
  const diffMs = new Date(t.slaDueAt).getTime() - Date.now();
  const hours = diffMs / 36e5;
  return `${diffMs < 0 ? '-' : ''}${Math.abs(hours).toFixed(1)}h`;
}

export default function Tickets() {
  const { data: tickets, loading, error, reload } = useApi(fetchTickets, []);
  const [activeStage, setActiveStage] = useState(null);
  const [selected, setSelected] = useState(null);

  const filtered = useMemo(() => {
    if (!tickets) return [];
    if (!activeStage) return tickets.filter((t) => t.status !== 'closed');
    return tickets.filter((t) => t.lifecycleStage === activeStage);
  }, [tickets, activeStage]);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading) return <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading tickets…</p>;

  return (
    <div>
      <LifecycleStrip tickets={tickets} activeStage={activeStage} onSelect={setActiveStage} />

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1.4fr 1fr' : '1fr', gap: 12 }}>
        <Card title={`${activeStage ? `${activeStage} tickets` : 'Active tickets'} (${filtered.length})`}>
          {filtered.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No tickets in this view.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={thStyle}>ID</th>
                  <th style={thStyle}>Title</th>
                  <th style={thStyle}>Priority</th>
                  <th style={thStyle}>Stage</th>
                  <th style={thStyle}>SLA</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => setSelected(t)}
                    style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', background: selected?.id === t.id ? 'var(--accent-soft)' : 'transparent' }}
                  >
                    <td style={tdStyle}>CC-{t.id}</td>
                    <td style={tdStyle}>{t.title}</td>
                    <td style={tdStyle}>
                      <Badge tone={t.priority}>{t.priority}</Badge>
                    </td>
                    <td style={tdStyle}>{t.lifecycleStage}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', color: t.breachedSla ? 'var(--danger)' : 'var(--text-muted)' }}>
                      {slaShortLabel(t)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {selected && (
          <TicketDetail
            ticket={selected}
            onClose={() => setSelected(null)}
            onChanged={() => {
              reload();
              setSelected(null);
            }}
          />
        )}
      </div>
    </div>
  );
}

const thStyle = { textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.3, padding: '6px 8px', borderBottom: '1px solid var(--border)' };
const tdStyle = { padding: '8px 8px' };
