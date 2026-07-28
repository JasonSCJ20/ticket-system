import { useState } from 'react';
import { Card, Badge } from '../components/ui.jsx';
import { fetchFindingBrief, confirmFinding, updateFindingStatus, createTicketFromFinding } from '../api/security.js';
import { useApi } from '../hooks/useApi.js';

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

export default function FindingDetail({ finding, onClose, onChanged }) {
  const brief = useApi(() => fetchFindingBrief(finding.id), [finding.id]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [reason, setReason] = useState('');

  const note = (tone, text) => setMessage({ tone, text });

  const handleConfirm = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await confirmFinding(finding.id);
      note('ok', 'Finding confirmed.');
      onChanged();
    } catch (err) {
      note('critical', err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleStatus = async (status) => {
    setBusy(true);
    setMessage(null);
    try {
      await updateFindingStatus(finding.id, status, reason.trim() || undefined);
      note('ok', `Status set to ${status}.`);
      setReason('');
      onChanged();
    } catch (err) {
      note('critical', err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleCreateTicket = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await createTicketFromFinding(finding.id);
      note('ok', `Ticket CC-${result.ticketId} created.`);
      onChanged();
    } catch (err) {
      note('critical', err.message);
    } finally {
      setBusy(false);
    }
  };

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
      {message && (
        <div
          style={{
            marginBottom: 10,
            padding: '8px 10px',
            borderRadius: 8,
            fontSize: 11.5,
            background: message.tone === 'ok' ? 'var(--success-soft)' : 'var(--danger-soft)',
            color: message.tone === 'ok' ? 'var(--success)' : 'var(--danger)',
          }}
        >
          {message.text}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <Badge tone={finding.severity}>{finding.severity}</Badge>
        <Badge tone={finding.riskBand}>{finding.riskBand} risk ({finding.riskScore})</Badge>
        <Badge tone={finding.status === 'remediated' ? 'ok' : finding.status === 'dismissed' ? 'low' : 'high'}>{finding.status}</Badge>
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 10px' }}>{finding.description}</p>

      {!brief.loading && !brief.error && (
        <div style={{ fontSize: 11.5, marginBottom: 12 }}>
          {narrative.businessImpact && <p><strong>Business impact:</strong> {narrative.businessImpact}</p>}
          {narrative.remediationRecommendation && <p><strong>Recommended action:</strong> {narrative.remediationRecommendation}</p>}
        </div>
      )}

      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
        <div>Source: {finding.sourceTool} ({finding.detectionMode})</div>
        <div>Category: {finding.category}</div>
        {finding.application && <div>Application: {finding.application.name}</div>}
        <div>First seen: {new Date(finding.firstSeenAt).toLocaleString()}</div>
        <div>Last seen: {new Date(finding.lastSeenAt).toLocaleString()}</div>
        {finding.ticketId && <div>Linked ticket: CC-{finding.ticketId}</div>}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
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
    </Card>
  );
}
