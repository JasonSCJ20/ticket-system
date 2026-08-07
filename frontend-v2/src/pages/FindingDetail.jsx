import { useState } from 'react';
import { Card, Badge, FeedbackBanner } from '../components/ui.jsx';
import { fetchFindingBrief, confirmFinding, updateFindingStatus, createTicketFromFinding } from '../api/security.js';
import { useApi } from '../hooks/useApi.js';
import { useActionFeedback } from '../hooks/useActionFeedback.js';

const STATUSES = ['new', 'investigating', 'remediated', 'dismissed'];

function btnStyle(color, outline = false) {
  return {
    padding: '6px 12px',
    borderRadius: 6,
    border: `1px solid ${color}`,
    background: outline ? 'transparent' : color,
    color: outline ? color : 'var(--bg)',
    fontSize: 11.5,
    fontWeight: 600,
    cursor: 'pointer',
  };
}

export default function FindingDetail({ finding, onClose, onChanged, readOnly = false }) {
  const brief = useApi(() => fetchFindingBrief(finding.id), [finding.id]);
  const [busy, setBusy] = useState(false);
  const { feedback, notifySuccess, notifyError, clear } = useActionFeedback();
  const [reason, setReason] = useState('');

  const handleConfirm = async () => {
    setBusy(true);
    clear();
    try {
      await confirmFinding(finding.id);
      notifySuccess('Finding confirmed.');
      onChanged();
    } catch (err) {
      notifyError(err, 'Failed to confirm that finding.');
    } finally {
      setBusy(false);
    }
  };

  const handleStatus = async (status) => {
    setBusy(true);
    clear();
    try {
      await updateFindingStatus(finding.id, status, reason.trim() || undefined);
      notifySuccess(`Status set to ${status}.`);
      setReason('');
      onChanged();
    } catch (err) {
      notifyError(err, 'Failed to update that finding\'s status.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateTicket = async () => {
    setBusy(true);
    clear();
    try {
      const result = await createTicketFromFinding(finding.id);
      notifySuccess(`Ticket CC-${result.ticketId} created.`);
      onChanged();
    } catch (err) {
      notifyError(err, 'Failed to create a ticket from that finding.');
    } finally {
      setBusy(false);
    }
  };

  // fetchFindingBrief(id) returns { ..., structured: { communication: { businessImpact, remediationRecommendation, executiveSummary } }, ... }
  // (see node-backend/src/services/findingIntelligence.js:enrichFindingRecord)
  const narrative = brief.data?.structured?.communication || {};

  return (
    <Card
      title={finding.title}
      right={
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16 }}>
          ×
        </button>
      }
    >
      <FeedbackBanner feedback={feedback} onDismiss={clear} />

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <Badge tone={finding.severity}>{finding.severity}</Badge>
        <Badge tone={finding.riskBand}>{finding.riskBand} risk ({finding.riskScore})</Badge>
        <Badge tone={finding.status === 'remediated' ? 'ok' : finding.status === 'dismissed' ? 'low' : 'high'}>{finding.status}</Badge>
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px' }}>{finding.description}</p>

      {!brief.loading && !brief.error && (narrative.businessImpact || narrative.remediationRecommendation) && (
        <div style={{ fontSize: 13, marginBottom: 14 }}>
          {narrative.businessImpact && (
            <div style={{ marginBottom: 10 }}>
              <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, color: 'var(--text-muted)', margin: '0 0 4px' }}>
                Why it matters
              </p>
              <p style={{ margin: 0 }}>{narrative.businessImpact}</p>
            </div>
          )}
          {narrative.remediationRecommendation && (
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, color: 'var(--text-muted)', margin: '0 0 4px' }}>
                Recommended action
              </p>
              <p style={{ margin: 0 }}>{narrative.remediationRecommendation}</p>
            </div>
          )}
        </div>
      )}

      {!readOnly && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          {!finding.manualConfirmed && (
            <button disabled={busy} onClick={handleConfirm} style={btnStyle('var(--accent)')}>
              Confirm finding
            </button>
          )}
          {!finding.ticketId && (
            <button disabled={busy} onClick={handleCreateTicket} style={btnStyle('var(--accent)')}>
              Create ticket
            </button>
          )}
        </div>
      )}

      <details style={{ marginBottom: 12 }}>
        <summary style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', cursor: 'pointer' }}>Technical details</summary>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>
          <div>Source: {finding.sourceTool} ({finding.detectionMode})</div>
          <div>Category: {finding.category}</div>
          {finding.application && <div>Application: {finding.application.name}</div>}
          <div>Risk score: {finding.riskScore}</div>
          <div>First seen: {new Date(finding.firstSeenAt).toLocaleString()}</div>
          <div>Last seen: {new Date(finding.lastSeenAt).toLocaleString()}</div>
          {finding.ticketId && <div>Linked ticket: CC-{finding.ticketId}</div>}
        </div>
      </details>

      {!readOnly && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
          <p style={{ fontSize: 11, fontWeight: 700, margin: '0 0 8px' }}>Change status</p>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional, audited)"
            style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', fontSize: 12, marginBottom: 8 }}
          />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {STATUSES.filter((s) => s !== finding.status).map((s) => (
              <button key={s} disabled={busy} onClick={() => handleStatus(s)} style={btnStyle('var(--accent)', true)}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
