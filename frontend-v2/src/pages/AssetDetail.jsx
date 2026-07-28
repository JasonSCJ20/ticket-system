import { useState, useRef, useEffect } from 'react';
import { Card, Badge } from '../components/ui.jsx';
import {
  issueAgentKey,
  setEdgeCredential,
  startVerification,
  pollVerification,
  setEnforcementMode,
  queueAgentCommand,
} from '../api/assetEnforcement.js';

const VERIFICATION_TONE = { verified: 'ok', pending: 'high', degraded: 'high', failed: 'critical', not_configured: 'low' };

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

const inputStyle = {
  width: '100%',
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'var(--text)',
  fontSize: 12,
  marginBottom: 8,
};

export default function AssetDetail({ asset, onClose, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [issuedKey, setIssuedKey] = useState(null);
  const [edgeToken, setEdgeToken] = useState('');
  const [verifyState, setVerifyState] = useState(null); // 'pending' | 'verified' | 'timeout' | 'unsupported'
  const [cmdAction, setCmdAction] = useState('block_ip');
  const [cmdTarget, setCmdTarget] = useState('');
  const [cmdReason, setCmdReason] = useState('');
  const pollRef = useRef(null);

  useEffect(() => () => clearInterval(pollRef.current), []);

  const note = (tone, text) => setMessage({ tone, text });

  const handleIssueAgentKey = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await issueAgentKey(asset.id);
      setIssuedKey(result.agentKey);
      note('ok', result.warning);
      onChanged();
    } catch (err) {
      note('critical', err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSetEdgeCredential = async () => {
    if (!edgeToken.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      await setEdgeCredential(asset.id, edgeToken.trim());
      setEdgeToken('');
      note('ok', 'Edge credential stored (encrypted). Asset is in shadow mode until verified.');
      onChanged();
    } catch (err) {
      note('critical', err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async () => {
    setBusy(true);
    setMessage(null);
    setVerifyState('pending');
    try {
      const { verificationId } = await startVerification(asset.id);
      let attempts = 0;
      pollRef.current = setInterval(async () => {
        attempts += 1;
        try {
          const poll = await pollVerification(asset.id, verificationId);
          if (poll.status === 'verified') {
            clearInterval(pollRef.current);
            setVerifyState('verified');
            note('ok', 'Canary verified — the agent confirmed it saw the probe. You can now promote to active mode.');
            onChanged();
            setBusy(false);
          } else if (attempts >= 20) {
            clearInterval(pollRef.current);
            setVerifyState('timeout');
            note('critical', 'Verification timed out — the agent never reported seeing the canary. Confirm the agent is running.');
            setBusy(false);
          }
        } catch (err) {
          clearInterval(pollRef.current);
          note('critical', err.message);
          setBusy(false);
        }
      }, 1500);
    } catch (err) {
      note('critical', err.message);
      setBusy(false);
    }
  };

  const handlePromote = async (mode) => {
    setBusy(true);
    setMessage(null);
    try {
      await setEnforcementMode(asset.id, mode);
      note('ok', `Enforcement mode set to ${mode}.`);
      onChanged();
    } catch (err) {
      note('critical', err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleQueueCommand = async () => {
    if (!cmdTarget.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      await queueAgentCommand(asset.id, cmdAction, cmdTarget.trim(), cmdReason.trim() || undefined);
      note('ok', `Command queued — the agent will pick it up on its next poll.`);
      setCmdTarget('');
      setCmdReason('');
    } catch (err) {
      note('critical', err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={asset.name}
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

      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 10, wordBreak: 'break-all' }}>{asset.baseUrl}</div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        <Badge tone={asset.enforcementModel === 'none' ? 'low' : 'medium'}>{asset.enforcementModel}</Badge>
        <Badge tone={asset.enforcementMode === 'active' ? 'ok' : 'high'}>{asset.enforcementMode}</Badge>
        <Badge tone={VERIFICATION_TONE[asset.verificationStatus] || 'low'}>{asset.verificationStatus}</Badge>
      </div>

      {asset.enforcementModel === 'none' && (
        <div style={{ marginBottom: 14 }}>
          <p style={{ fontSize: 11.5, fontWeight: 700, margin: '0 0 8px' }}>Choose an enforcement model</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
              <p style={{ fontSize: 11, fontWeight: 700, margin: '0 0 4px' }}>Embedded agent</p>
              <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '0 0 8px' }}>
                For systems you built and fully control. Install <code>@commandcentre/agent</code> and issue a key.
              </p>
              <button disabled={busy} onClick={handleIssueAgentKey} style={btnStyle('var(--accent)')}>
                Issue agent key
              </button>
            </div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
              <p style={{ fontSize: 11, fontWeight: 700, margin: '0 0 4px' }}>Edge enforcement</p>
              <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '0 0 8px' }}>
                For pre-built client systems. Provide a narrowly-scoped API token for their edge/WAF.
              </p>
              <input
                value={edgeToken}
                onChange={(e) => setEdgeToken(e.target.value)}
                placeholder="Scoped API token"
                type="password"
                style={inputStyle}
              />
              <button disabled={busy} onClick={handleSetEdgeCredential} style={btnStyle('var(--accent)')}>
                Store credential
              </button>
            </div>
          </div>
        </div>
      )}

      {issuedKey && (
        <div style={{ marginBottom: 14, border: '1px solid var(--warning)', borderRadius: 8, padding: 10 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--warning)', margin: '0 0 6px' }}>
            Agent key — shown once, store it now
          </p>
          <code style={{ display: 'block', fontSize: 11, wordBreak: 'break-all', background: 'var(--surface-2)', padding: 8, borderRadius: 6 }}>
            {issuedKey}
          </code>
        </div>
      )}

      {asset.enforcementModel !== 'none' && (
        <>
          <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-muted)', marginBottom: 14 }}>
            <span>Last heartbeat: {asset.lastHeartbeatAt ? new Date(asset.lastHeartbeatAt).toLocaleString() : 'never'}</span>
            <span>Last verified: {asset.lastVerifiedAt ? new Date(asset.lastVerifiedAt).toLocaleString() : 'never'}</span>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <button disabled={busy} onClick={handleVerify} style={btnStyle('var(--accent)')}>
              {verifyState === 'pending' ? 'Verifying…' : 'Run canary verification'}
            </button>
            {asset.enforcementMode === 'shadow' ? (
              <button disabled={busy || asset.verificationStatus !== 'verified'} onClick={() => handlePromote('active')} style={btnStyle('var(--success)')}>
                Promote to active
              </button>
            ) : (
              <button disabled={busy} onClick={() => handlePromote('shadow')} style={btnStyle('var(--warning)', true)}>
                Revert to shadow
              </button>
            )}
          </div>

          <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
            <p style={{ fontSize: 11, fontWeight: 700, margin: '0 0 8px' }}>Send a kill command</p>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <select value={cmdAction} onChange={(e) => setCmdAction(e.target.value)} style={{ ...inputStyle, marginBottom: 0, flex: '0 0 auto' }}>
                <option value="block_ip">block_ip</option>
                <option value="block_session">block_session</option>
                <option value="unblock_ip">unblock_ip</option>
              </select>
              <input
                value={cmdTarget}
                onChange={(e) => setCmdTarget(e.target.value)}
                placeholder="IP or session id"
                style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
              />
            </div>
            <input
              value={cmdReason}
              onChange={(e) => setCmdReason(e.target.value)}
              placeholder="Reason (optional, audited)"
              style={inputStyle}
            />
            <button disabled={busy} onClick={handleQueueCommand} style={btnStyle('var(--accent)')}>
              Queue command
            </button>
          </div>
        </>
      )}
    </Card>
  );
}
