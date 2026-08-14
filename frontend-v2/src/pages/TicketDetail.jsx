import { useState } from 'react';
import { useApi } from '../hooks/useApi.js';
import { useActionFeedback } from '../hooks/useActionFeedback.js';
import * as ticketsApi from '../api/tickets.js';
import { fetchUsers } from '../api/users.js';
import { LIFECYCLE_LABELS } from '../api/tickets.js';
import { analyzeTicket, tendTicket } from '../api/assistant.js';
import { Card, Chip, FeedbackBanner, Timeline } from '../components/ui.jsx';

function slaLabel(slaDueAt, breachedSla) {
  if (!slaDueAt) return null;
  const diffMs = new Date(slaDueAt).getTime() - Date.now();
  const hours = Math.abs(diffMs) / 36e5;
  const label = hours >= 1 ? `${hours.toFixed(1)}h` : `${Math.round(hours * 60)}m`;
  return breachedSla || diffMs < 0 ? `Overdue by ${label}` : `${label} left`;
}

function timeAgo(dateString) {
  const diffMs = Date.now() - new Date(dateString).getTime();
  const hours = diffMs / 36e5;
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min ago`;
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const LIFECYCLE_TIMESTAMP_FIELDS = [
  ['triagedAt', 'triaged'],
  ['containedAt', 'contained'],
  ['eradicatedAt', 'eradicated'],
  ['recoveredAt', 'recovered'],
  ['postmortemAt', 'postmortem'],
  ['closedAt', 'closed'],
];

const EVENT_LABELS = {
  created: 'Ticket created',
  updated: 'Ticket updated',
  transition: 'Stage changed',
  comment_added: 'Note added',
  action_item_created: 'Action item added',
  action_item_updated: 'Action item updated',
  finding_status_update: 'Linked finding updated',
};

function buildTimeline(ticket, historyRows) {
  const entries = [];
  for (const [field, stage] of LIFECYCLE_TIMESTAMP_FIELDS) {
    if (ticket[field]) {
      entries.push({ at: ticket[field], text: `Moved to "${LIFECYCLE_LABELS[stage]}"`, tone: 'muted' });
    }
  }
  for (const row of historyRows || []) {
    entries.push({
      at: row.createdAt,
      text: row.reason ? `${EVENT_LABELS[row.eventType] || row.eventType}: ${row.reason}` : (EVENT_LABELS[row.eventType] || row.eventType),
      tone: 'muted',
    });
  }
  entries.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  if (entries.length) entries[0].tone = 'warning';
  return entries.map((e) => ({ ...e, when: timeAgo(e.at) }));
}

function DetailField({ label, value, editing, onChange, onSave, onEdit, busy }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.4, color: 'var(--text-muted)', textTransform: 'uppercase', margin: 0 }}>{label}</p>
        {!editing && <button onClick={onEdit} style={{ fontSize: 11, padding: '2px 6px' }}>{value ? 'Edit' : 'Add'}</button>}
      </div>
      {editing ? (
        <div>
          <textarea
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            rows={3}
            style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', fontSize: 12.5, marginBottom: 6 }}
          />
          <button disabled={busy} onClick={onSave} style={{ fontSize: 11.5, padding: '4px 10px' }}>Save</button>
        </div>
      ) : (
        <p style={{ fontSize: 13, margin: 0, color: value ? 'var(--text)' : 'var(--text-muted)' }}>{value || 'Not yet determined.'}</p>
      )}
    </div>
  );
}

export default function TicketDetail({ ticket, onClose, onChanged }) {
  const comments = useApi(() => ticketsApi.fetchComments(ticket.id), [ticket.id]);
  const actionItems = useApi(() => ticketsApi.fetchActionItems(ticket.id), [ticket.id]);
  const history = useApi(() => ticketsApi.fetchHistory(ticket.id), [ticket.id]);
  const staff = useApi(fetchUsers, []);
  const [newComment, setNewComment] = useState('');
  const [busy, setBusy] = useState(false);
  const { feedback, notifySuccess, notifyError, clear } = useActionFeedback();
  const [editingField, setEditingField] = useState(null);
  const [fieldDrafts, setFieldDrafts] = useState({ rootCause: ticket.rootCause, actionsTaken: ticket.actionsTaken, preventiveActions: ticket.preventiveActions });
  const [reassigning, setReassigning] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);

  const handleAskAi = async () => {
    setAiBusy(true);
    clear();
    try {
      const result = await analyzeTicket(ticket.id);
      setAiResult(result);
    } catch (err) {
      notifyError(err, 'The assistant could not analyze this ticket.');
    } finally {
      setAiBusy(false);
    }
  };

  const handleAiRespond = async () => {
    if (!window.confirm("Let the assistant advance this ticket automatically? This may change its status/stage and add a follow-up action item.")) return;
    setAiBusy(true);
    clear();
    try {
      const result = await tendTicket(ticket.id);
      notifySuccess(result.actionSummary || 'The assistant acted on this ticket.');
      onChanged();
    } catch (err) {
      notifyError(err, 'The assistant could not act on this ticket.');
    } finally {
      setAiBusy(false);
    }
  };

  const currentIndex = ticketsApi.LIFECYCLE_STAGES.indexOf(ticket.lifecycleStage || 'identified');
  const nextStage = ticketsApi.LIFECYCLE_STAGES[currentIndex + 1];

  const handleAdvance = async () => {
    if (!nextStage) return;
    setBusy(true);
    clear();
    try {
      await ticketsApi.transitionTicket(ticket.id, nextStage);
      onChanged();
    } catch (err) {
      notifyError(err, `Failed to move this ticket to ${ticketsApi.LIFECYCLE_LABELS[nextStage]}.`);
    } finally {
      setBusy(false);
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) return;
    setBusy(true);
    clear();
    try {
      await ticketsApi.addComment(ticket.id, { message: newComment.trim() });
      setNewComment('');
      comments.reload();
      history.reload();
    } catch (err) {
      notifyError(err, 'Failed to add that note.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveField = async (field) => {
    setBusy(true);
    clear();
    try {
      await ticketsApi.updateTicket(ticket.id, { [field]: fieldDrafts[field] });
      setEditingField(null);
      onChanged();
    } catch (err) {
      notifyError(err, 'Failed to save that.');
    } finally {
      setBusy(false);
    }
  };

  const handleReassign = async (scjId) => {
    setBusy(true);
    clear();
    try {
      await ticketsApi.updateTicket(ticket.id, { assigneeId: scjId });
      setReassigning(false);
      onChanged();
    } catch (err) {
      notifyError(err, 'Failed to reassign this ticket.');
    } finally {
      setBusy(false);
    }
  };

  const sla = slaLabel(ticket.slaDueAt, ticket.breachedSla);
  const assigneeName = ticket.assignee ? `${ticket.assignee.name || ''} ${ticket.assignee.surname || ''}`.trim() : null;
  const eligibleStaff = (staff.data || []).filter((u) => u.role === 'admin' || u.role === 'analyst');
  const timeline = buildTimeline(ticket, history.data);

  return (
    <Card
      title={
        <span>
          {ticket.title} <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--danger)' }}>{ticket.priority} priority</span>
        </span>
      }
      right={
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16 }}>
          ×
        </button>
      }
    >
      <FeedbackBanner feedback={feedback} onDismiss={clear} />

      <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.4, color: 'var(--text-muted)', textTransform: 'uppercase', margin: '0 0 4px' }}>What</p>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 14px' }}>{ticket.description}</p>

      <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.4, color: 'var(--text-muted)', textTransform: 'uppercase', margin: '0 0 6px' }}>Where</p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {(ticket.assets || []).length === 0
          ? <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No asset linked.</span>
          : ticket.assets.map((a) => <Chip key={a.id}>{a.assetName}</Chip>)}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 14 }}>
        <div>
          <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.4, color: 'var(--text-muted)', textTransform: 'uppercase', margin: '0 0 6px' }}>Who</p>
          {reassigning ? (
            <select
              disabled={busy || staff.loading}
              defaultValue={ticket.assigneeId || ''}
              onChange={(e) => handleReassign(e.target.value || null)}
              style={{ fontSize: 12.5, padding: '5px 6px', maxWidth: '100%' }}
            >
              <option value="">Unassigned</option>
              {eligibleStaff.map((u) => (
                <option key={u.id} value={u.scjId}>{u.name} {u.surname}</option>
              ))}
            </select>
          ) : (
            <>
              <p style={{ fontSize: 13, margin: 0 }}>{assigneeName || 'Unassigned'}</p>
              <button onClick={() => setReassigning(true)} style={{ fontSize: 11, padding: '3px 8px', marginTop: 6 }}>Reassign</button>
            </>
          )}
        </div>
        <div>
          <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.4, color: 'var(--text-muted)', textTransform: 'uppercase', margin: '0 0 6px' }}>When</p>
          <p style={{ fontSize: 13, margin: 0 }}>Opened {timeAgo(ticket.createdAt)}</p>
          {sla && <p style={{ fontSize: 13, margin: '2px 0 0', color: sla.startsWith('Overdue') ? 'var(--danger)' : 'var(--text-muted)' }}>{sla}</p>}
        </div>
      </div>

      <DetailField
        label="Why — root cause"
        value={editingField === 'rootCause' ? fieldDrafts.rootCause : (ticket.rootCause || fieldDrafts.rootCause)}
        editing={editingField === 'rootCause'}
        onChange={(v) => setFieldDrafts((d) => ({ ...d, rootCause: v }))}
        onEdit={() => setEditingField('rootCause')}
        onSave={() => handleSaveField('rootCause')}
        busy={busy}
      />

      {ticket.executiveSummary && (
        <div style={{ marginBottom: 14 }}>
          <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.4, color: 'var(--text-muted)', textTransform: 'uppercase', margin: '0 0 4px' }}>Why it matters</p>
          <p style={{ fontSize: 13, margin: 0 }}>{ticket.executiveSummary}</p>
        </div>
      )}

      <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.4, color: 'var(--text-muted)', textTransform: 'uppercase', margin: '0 0 8px' }}>How</p>

      <div style={{ marginBottom: 10 }}>
        {actionItems.loading && <p style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Loading…</p>}
        {actionItems.data?.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No action items yet.</p>}
        {actionItems.data?.map((item) => (
          <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '4px 0' }}>
            <span>{item.title}</span>
            <span style={{ fontSize: 12, fontWeight: 500, color: item.status === 'done' ? 'var(--success)' : item.status === 'blocked' ? 'var(--danger)' : 'var(--text-muted)' }}>{item.status}</span>
          </div>
        ))}
      </div>

      <DetailField
        label="Actions taken"
        value={editingField === 'actionsTaken' ? fieldDrafts.actionsTaken : (ticket.actionsTaken || fieldDrafts.actionsTaken)}
        editing={editingField === 'actionsTaken'}
        onChange={(v) => setFieldDrafts((d) => ({ ...d, actionsTaken: v }))}
        onEdit={() => setEditingField('actionsTaken')}
        onSave={() => handleSaveField('actionsTaken')}
        busy={busy}
      />
      <DetailField
        label="Preventing recurrence"
        value={editingField === 'preventiveActions' ? fieldDrafts.preventiveActions : (ticket.preventiveActions || fieldDrafts.preventiveActions)}
        editing={editingField === 'preventiveActions'}
        onChange={(v) => setFieldDrafts((d) => ({ ...d, preventiveActions: v }))}
        onEdit={() => setEditingField('preventiveActions')}
        onSave={() => handleSaveField('preventiveActions')}
        busy={busy}
      />

      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {nextStage && (
          <button
            onClick={handleAdvance}
            disabled={busy}
            style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'var(--bg)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}
          >
            Move to "{ticketsApi.LIFECYCLE_LABELS[nextStage]}"
          </button>
        )}
      </div>

      <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, marginBottom: 16 }}>
        <p style={{ fontSize: 11, fontWeight: 700, margin: '0 0 8px' }}>Assistant</p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: aiResult ? 10 : 0 }}>
          <button
            disabled={aiBusy}
            onClick={handleAskAi}
            style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--accent)', background: 'transparent', color: 'var(--accent)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}
          >
            Analyze
          </button>
          <button
            disabled={aiBusy}
            onClick={handleAiRespond}
            style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'var(--bg)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}
          >
            Auto-advance
          </button>
        </div>
        {aiResult && (
          <div style={{ fontSize: 12.5 }}>
            <p style={{ margin: '0 0 6px' }}>{aiResult.summary}</p>
            <ul style={{ margin: '0 0 8px', paddingLeft: 18, color: 'var(--text-muted)' }}>
              {aiResult.productivityPlan.map((step, i) => <li key={i} style={{ marginBottom: 2 }}>{step}</li>)}
            </ul>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontStyle: 'italic' }}>{aiResult.coaching}</p>
          </div>
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <p style={{ fontSize: 12.5, fontWeight: 600, margin: '0 0 10px' }}>Progress — every touch on this ticket</p>
        {history.loading ? (
          <p style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Loading…</p>
        ) : timeline.length === 0 ? (
          <p style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>No activity recorded yet.</p>
        ) : (
          <Timeline items={timeline} />
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12 }}>
        <p style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>Notes</p>
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
            placeholder="Add a note"
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
