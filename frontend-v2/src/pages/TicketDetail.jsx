import { useState } from 'react';
import { useApi } from '../hooks/useApi.js';
import * as ticketsApi from '../api/tickets.js';
import { Card, Badge, ErrorState } from '../components/ui.jsx';

function slaLabel(slaDueAt, breachedSla) {
  if (!slaDueAt) return null;
  const diffMs = new Date(slaDueAt).getTime() - Date.now();
  const hours = Math.abs(diffMs) / 36e5;
  const label = hours >= 1 ? `${hours.toFixed(1)}h` : `${Math.round(hours * 60)}m`;
  return breachedSla || diffMs < 0 ? `-${label}` : label;
}

export default function TicketDetail({ ticket, onClose, onChanged }) {
  const comments = useApi(() => ticketsApi.fetchComments(ticket.id), [ticket.id]);
  const actionItems = useApi(() => ticketsApi.fetchActionItems(ticket.id), [ticket.id]);
  const [newComment, setNewComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const currentIndex = ticketsApi.LIFECYCLE_STAGES.indexOf(ticket.lifecycleStage || 'identified');
  const nextStage = ticketsApi.LIFECYCLE_STAGES[currentIndex + 1];

  const handleAdvance = async () => {
    if (!nextStage) return;
    setBusy(true);
    setError(null);
    try {
      await ticketsApi.transitionTicket(ticket.id, nextStage);
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await ticketsApi.addComment(ticket.id, { message: newComment.trim() });
      setNewComment('');
      comments.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const sla = slaLabel(ticket.slaDueAt, ticket.breachedSla);

  return (
    <Card
      title={
        <span>
          {ticket.title} <Badge tone={ticket.priority}>{ticket.priority}</Badge>
        </span>
      }
      right={
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}>
          Close
        </button>
      }
    >
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px' }}>{ticket.description}</p>

      <table style={{ width: '100%', fontSize: 12, marginBottom: 12 }}>
        <tbody>
          <tr>
            <td style={{ color: 'var(--text-muted)', width: 90 }}>Who</td>
            <td>{ticket.assignee ? `${ticket.assignee.name || ''} ${ticket.assignee.surname || ''}`.trim() : 'Unassigned'}</td>
          </tr>
          <tr>
            <td style={{ color: 'var(--text-muted)' }}>Stage</td>
            <td>{ticket.lifecycleStage}</td>
          </tr>
          {sla && (
            <tr>
              <td style={{ color: 'var(--text-muted)' }}>SLA</td>
              <td style={{ color: ticket.breachedSla ? 'var(--danger)' : 'var(--text)' }}>{sla}</td>
            </tr>
          )}
          {ticket.impactedServices && (
            <tr>
              <td style={{ color: 'var(--text-muted)' }}>Impact</td>
              <td>{ticket.impactedServices}</td>
            </tr>
          )}
        </tbody>
      </table>

      {error && <ErrorState error={error} />}

      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {nextStage && (
          <button
            onClick={handleAdvance}
            disabled={busy}
            style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'var(--bg)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}
          >
            Advance to {nextStage}
          </button>
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>Action items</div>
        {actionItems.loading && <p style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Loading…</p>}
        {actionItems.data?.length === 0 && <p style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>None yet.</p>}
        {actionItems.data?.map((item) => (
          <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, padding: '4px 0' }}>
            <span>{item.title}</span>
            <Badge tone={item.status === 'done' ? 'ok' : item.status === 'blocked' ? 'critical' : 'medium'}>{item.status}</Badge>
          </div>
        ))}
      </div>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>Comments</div>
        {comments.loading && <p style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Loading…</p>}
        {comments.data?.map((c) => (
          <div key={c.id} style={{ fontSize: 11.5, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ color: 'var(--text-muted)' }}>{c.authorName} · {c.visibility}</div>
            <div>{c.message}</div>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Add a comment"
            style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', fontSize: 12 }}
          />
          <button
            onClick={handleAddComment}
            disabled={busy}
            style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', fontSize: 11.5, cursor: 'pointer' }}
          >
            Send
          </button>
        </div>
      </div>
    </Card>
  );
}
