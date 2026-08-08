import { useState, useRef, useEffect } from 'react';
import { Card, Badge, FeedbackBanner } from '../components/ui.jsx';
import { useActionFeedback } from '../hooks/useActionFeedback.js';
import { useAuth } from '../auth/AuthContext.jsx';
import {
  issueAgentKey,
  setEdgeCredential,
  startVerification,
  pollVerification,
  setEnforcementMode,
  queueAgentCommand,
  issueSentinelKey,
  setSentinelMode,
  resetEnforcement,
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
  const { role } = useAuth();
  const [busy, setBusy] = useState(false);
  const { feedback, notifySuccess, notifyError, clear } = useActionFeedback();
  const [issuedKey, setIssuedKey] = useState(null);
  const [issuedSentinelKey, setIssuedSentinelKey] = useState(null);
  const [edgeToken, setEdgeToken] = useState('');
  const [edgeZoneId, setEdgeZoneId] = useState('');
  const [verifyState, setVerifyState] = useState(null); // 'pending' | 'verified' | 'timeout' | 'unsupported'
  const [cmdAction, setCmdAction] = useState('block_ip');
  const [cmdTarget, setCmdTarget] = useState('');
  const [cmdReason, setCmdReason] = useState('');
  const pollRef = useRef(null);

  useEffect(() => () => clearInterval(pollRef.current), []);

  const handleIssueAgentKey = async () => {
    setBusy(true);
    clear();
    try {
      const result = await issueAgentKey(asset.id);
      setIssuedKey(result.agentKey);
      notifySuccess(result.warning);
      onChanged();
    } catch (err) {
      notifyError(err, 'Failed to issue an agent key.');
    } finally {
      setBusy(false);
    }
  };

  const handleIssueSentinelKey = async () => {
    setBusy(true);
    clear();
    try {
      const result = await issueSentinelKey(asset.id);
      setIssuedSentinelKey(result.sentinelKey);
      notifySuccess(result.warning);
      onChanged();
    } catch (err) {
      notifyError(err, 'Failed to issue a sentinel key.');
    } finally {
      setBusy(false);
    }
  };

  const handlePromoteSentinel = async (mode) => {
    setBusy(true);
    clear();
    try {
      await setSentinelMode(asset.id, mode);
      notifySuccess(`Sentinel mode set to ${mode}.`);
      onChanged();
    } catch (err) {
      if (err.status === 409) {
        notifyError({ message: err.message || 'No sentinel heartbeat received yet — confirm the sentinel service is installed and running.' });
      } else {
        notifyError(err, 'Failed to change sentinel mode.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSetEdgeCredential = async () => {
    if (!edgeToken.trim() || !edgeZoneId.trim()) return;
    setBusy(true);
    clear();
    try {
      await setEdgeCredential(asset.id, edgeToken.trim(), { zoneId: edgeZoneId.trim() });
      setEdgeToken('');
      setEdgeZoneId('');
      notifySuccess('Edge credential stored (encrypted). Asset is in shadow mode until verified.');
      onChanged();
    } catch (err) {
      notifyError(err, 'Failed to store that edge credential.');
    } finally {
      setBusy(false);
    }
  };

  const handleResetEnforcement = async () => {
    if (!window.confirm(`Reset enforcement setup for ${asset.name}? This clears the current ${asset.enforcementModel} configuration and any stored credential/key for it — you'll need to set it up again from scratch.`)) return;
    setBusy(true);
    clear();
    try {
      await resetEnforcement(asset.id);
      notifySuccess('Enforcement setup reset — choose a model below to start again.');
      onChanged();
    } catch (err) {
      notifyError(err, 'Failed to reset enforcement setup.');
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async () => {
    setBusy(true);
    clear();
    setVerifyState('pending');

    // Edge model has no agent to fire a probe at and wait for — CommandCentre
    // asks the provider (Cloudflare) directly whether this token controls
    // this zone, so the result comes back synchronously, no polling needed.
    if (asset.enforcementModel === 'edge') {
      try {
        const result = await startVerification(asset.id);
        if (result.status === 'verified') {
          setVerifyState('verified');
          notifySuccess('Verified — CommandCentre confirmed this token actually controls the zone. You can now promote to active mode.');
          onChanged();
        } else {
          setVerifyState('timeout');
          notifyError({ message: result.reason || 'Cloudflare rejected this credential.' });
        }
      } catch (err) {
        setVerifyState('timeout');
        notifyError(err, 'Failed to verify this edge credential.');
      } finally {
        setBusy(false);
      }
      return;
    }

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
            notifySuccess('Canary verified — the agent confirmed it saw the probe. You can now promote to active mode.');
            onChanged();
            setBusy(false);
          } else if (attempts >= 20) {
            clearInterval(pollRef.current);
            setVerifyState('timeout');
            notifyError(
              { message: 'Verification timed out — the agent never reported seeing the canary. Confirm the agent is installed and running, then try again.' },
            );
            setBusy(false);
          }
        } catch (err) {
          clearInterval(pollRef.current);
          notifyError(err, 'Verification check failed.');
          setBusy(false);
        }
      }, 1500);
    } catch (err) {
      if (err.status === 409) {
        notifyError({ message: 'No agent heartbeat received yet — confirm the agent is installed and running before verifying.' });
      } else {
        notifyError(err, 'Failed to start verification.');
      }
      setBusy(false);
    }
  };

  const handlePromote = async (mode) => {
    setBusy(true);
    clear();
    try {
      await setEnforcementMode(asset.id, mode);
      notifySuccess(`Enforcement mode set to ${mode}.`);
      onChanged();
    } catch (err) {
      if (err.status === 409 && mode === 'active') {
        notifyError({ message: 'Cannot promote to active enforcement until verification succeeds — run the canary verification first.' });
      } else {
        notifyError(err, 'Failed to change enforcement mode.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleQueueCommand = async () => {
    if (!cmdTarget.trim()) return;
    setBusy(true);
    clear();
    try {
      const command = await queueAgentCommand(asset.id, cmdAction, cmdTarget.trim(), cmdReason.trim() || undefined);
      if (asset.enforcementModel === 'edge') {
        if (command.status === 'acknowledged') {
          notifySuccess(`Done — Cloudflare confirmed the ${cmdAction} action took effect immediately.`);
        } else {
          notifyError({ message: command.failureReason || 'Cloudflare did not confirm this action.' });
        }
      } else {
        notifySuccess('Command queued — the agent will pick it up on its next poll.');
      }
      setCmdTarget('');
      setCmdReason('');
    } catch (err) {
      notifyError(err, 'Failed to execute that command.');
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
      <FeedbackBanner feedback={feedback} onDismiss={clear} />

      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 10, wordBreak: 'break-all' }}>
        {[asset.baseUrl, asset.ipAddress].filter(Boolean).join(' · ') || 'No endpoint configured'}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        <Badge tone="low">{asset.assetType}</Badge>
        <Badge tone={asset.enforcementModel === 'none' ? 'low' : 'medium'}>{asset.enforcementModel}</Badge>
        <Badge tone={asset.enforcementMode === 'active' ? 'ok' : 'high'}>{asset.enforcementMode}</Badge>
        <Badge tone={VERIFICATION_TONE[asset.verificationStatus] || 'low'}>{asset.verificationStatus}</Badge>
        <Badge tone={asset.hasSentinelKey ? (asset.sentinelMode === 'active' ? 'ok' : 'high') : 'low'}>
          sentinel: {asset.hasSentinelKey ? asset.sentinelMode : 'not installed'}
        </Badge>
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
                placeholder="Scoped Cloudflare API token"
                type="password"
                style={inputStyle}
              />
              <input
                value={edgeZoneId}
                onChange={(e) => setEdgeZoneId(e.target.value)}
                placeholder="Cloudflare zone ID"
                style={inputStyle}
              />
              <button disabled={busy || !edgeToken.trim() || !edgeZoneId.trim()} onClick={handleSetEdgeCredential} style={btnStyle('var(--accent)')}>
                Store credential
              </button>
            </div>
          </div>
        </div>
      )}

      {asset.enforcementModel !== 'none' && role === 'admin' && (
        <div style={{ marginBottom: 14, border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
          <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '0 0 8px' }}>
            Enforcement model is set to <strong>{asset.enforcementModel}</strong>. Wrong for this asset (e.g. it turned
            out to be a Cloudflare Workers app that needs edge enforcement instead of an embedded agent)? Reset it to
            choose again.
          </p>
          <button disabled={busy} onClick={handleResetEnforcement} style={btnStyle('var(--danger)', true)}>
            Change enforcement model
          </button>
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

      <div style={{ marginBottom: 14, border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
        <p style={{ fontSize: 11.5, fontWeight: 700, margin: '0 0 4px' }}>Host-level sentinel</p>
        <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '0 0 8px' }}>
          Real port/connection visibility and firewall-level isolation on this asset's own host — runs alongside (not
          instead of) the enforcement model above. Works for any asset type, including routers and bare servers with
          no web endpoint at all.
        </p>

        {!asset.hasSentinelKey && (
          <button disabled={busy} onClick={handleIssueSentinelKey} style={btnStyle('var(--accent)')}>
            Issue sentinel key
          </button>
        )}

        {issuedSentinelKey && (
          <div style={{ margin: '10px 0', border: '1px solid var(--warning)', borderRadius: 8, padding: 10 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--warning)', margin: '0 0 6px' }}>
              Sentinel key — shown once, store it now
            </p>
            <code style={{ display: 'block', fontSize: 11, wordBreak: 'break-all', background: 'var(--surface-2)', padding: 8, borderRadius: 6 }}>
              {issuedSentinelKey}
            </code>
          </div>
        )}

        {asset.hasSentinelKey && (
          <>
            <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
              <span>Last heartbeat: {asset.lastSentinelHeartbeatAt ? new Date(asset.lastSentinelHeartbeatAt).toLocaleString() : 'never'}</span>
            </div>
            {asset.lastKnownOpenPorts?.length > 0 && (
              <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '0 0 10px' }}>
                Open ports: {asset.lastKnownOpenPorts.join(', ')}
              </p>
            )}
            {asset.sentinelMode === 'shadow' ? (
              <button disabled={busy || !asset.lastSentinelHeartbeatAt} onClick={() => handlePromoteSentinel('active')} style={btnStyle('var(--success)')}>
                Promote sentinel to active
              </button>
            ) : (
              <button disabled={busy} onClick={() => handlePromoteSentinel('shadow')} style={btnStyle('var(--warning)', true)}>
                Revert sentinel to shadow
              </button>
            )}
          </>
        )}
      </div>

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

        </>
      )}

      {(asset.enforcementModel !== 'none' || asset.hasSentinelKey) && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
          <p style={{ fontSize: 11, fontWeight: 700, margin: '0 0 8px' }}>Send a kill command</p>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <select value={cmdAction} onChange={(e) => setCmdAction(e.target.value)} style={{ ...inputStyle, marginBottom: 0, flex: '0 0 auto' }}>
              <option value="block_ip">block_ip</option>
              {asset.enforcementModel === 'agent' && <option value="block_session">block_session</option>}
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
      )}
    </Card>
  );
}
