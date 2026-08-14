import { useState, useMemo } from 'react';
import { useApi } from '../hooks/useApi.js';
import { fetchTickets } from '../api/tickets.js';
import { Card, ErrorState, StatCard, StatCardRow, Chip, StatusDot } from '../components/ui.jsx';
import LifecycleStrip from '../components/LifecycleStrip.jsx';
import TicketDetail from './TicketDetail.jsx';

// Ticket priority was previously shown as a color-only dot with no text
// anywhere in the row — invisible information for colorblind users, and
// genuinely absent (not just decorative) for everyone else since no other
// part of the row named the priority at all.
const PRIORITY_LABEL = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
function priorityTone(priority) {
  if (priority === 'critical' || priority === 'high') return 'danger';
  if (priority === 'medium') return 'warning';
  return 'muted';
}

function slaLabel(t) {
  if (!t.slaDueAt) return null;
  const diffMs = new Date(t.slaDueAt).getTime() - Date.now();
  const hours = Math.abs(diffMs) / 36e5;
  const label = hours >= 1 ? `${hours.toFixed(0)}h` : `${Math.round(hours * 60)}m`;
  return diffMs < 0 ? `Overdue ${label}` : `${label} left`;
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

  const kpis = useMemo(() => {
    if (!tickets) return { open: 0, overdue: 0, closedThisWeek: 0 };
    const open = tickets.filter((t) => t.status !== 'closed').length;
    const overdue = tickets.filter((t) => t.slaDueAt && new Date(t.slaDueAt) < new Date() && t.status !== 'closed' && t.status !== 'resolved').length;
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const closedThisWeek = tickets.filter((t) => t.status === 'closed' && t.closedAt && new Date(t.closedAt).getTime() >= weekAgo).length;
    return { open, overdue, closedThisWeek };
  }, [tickets]);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading) return <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading tickets…</p>;

  return (
    <div>
      <StatCardRow>
        <StatCard label="Open tickets" value={kpis.open} />
        <StatCard label="Overdue" value={kpis.overdue} tone={kpis.overdue > 0 ? 'danger' : undefined} />
        <StatCard label="Closed this week" value={kpis.closedThisWeek} />
      </StatCardRow>

      <LifecycleStrip tickets={tickets} activeStage={activeStage} onSelect={setActiveStage} />

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1.4fr 1fr' : '1fr', gap: 12 }}>
        <Card title={`${activeStage ? `${activeStage} tickets` : 'Active tickets'} (${filtered.length})`}>
          {filtered.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No tickets in this view.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {filtered.map((t, i) => {
                const sla = slaLabel(t);
                const isOverdue = sla?.startsWith('Overdue');
                return (
                  <div
                    key={t.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelected(t)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelected(t);
                      }
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '12px 4px',
                      borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                      cursor: 'pointer',
                      background: selected?.id === t.id ? 'var(--accent-soft)' : 'transparent',
                      borderRadius: 'var(--radius)',
                    }}
                  >
                    <StatusDot tone={priorityTone(t.priority)} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 14, margin: 0 }}>{t.title}</p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: `var(--${priorityTone(t.priority) === 'muted' ? 'text-muted' : priorityTone(t.priority)})` }}>
                          {PRIORITY_LABEL[t.priority] || t.priority}
                        </span>
                        {(t.assets || []).map((a) => <Chip key={a.id}>{a.assetName}</Chip>)}
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t.assignee ? `${t.assignee.name || ''} ${t.assignee.surname || ''}`.trim() : 'Unassigned'}</span>
                      </div>
                    </div>
                    {sla && <span style={{ fontSize: 12, fontWeight: 500, color: isOverdue ? 'var(--danger)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>{sla}</span>}
                  </div>
                );
              })}
            </div>
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
