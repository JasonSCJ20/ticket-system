import { useState } from 'react';
import { useApi } from '../hooks/useApi.js';
import { useActionFeedback } from '../hooks/useActionFeedback.js';
import { fetchFortressPosture, runRecoveryDrill } from '../api/security.js';
import { fetchKillSwitchStatus, revokeAllSessions, blockIp, unblockIp, setLockdown } from '../api/fortressKillSwitch.js';
import { Card, Badge, ErrorState, FeedbackBanner } from '../components/ui.jsx';
import Gauge from '../components/charts/Gauge.jsx';

const CONTROL_LABELS = {
  identity: 'Identity',
  patching: 'Patching',
  dataProtection: 'Data protection',
  recovery: 'Recovery',
  detection: 'Detection',
  telemetry: 'Telemetry',
};

const CONTROL_TONE = { controlled: 'ok', watch: 'high', critical: 'critical' };

function scoreColor(score) {
  if (score >= 85) return 'var(--success)';
  if (score >= 65) return 'var(--accent)';
  if (score >= 45) return 'var(--warning)';
  return 'var(--danger)';
}

export default function Fortress() {
  const posture = useApi(fetchFortressPosture, []);
  const killSwitch = useApi(fetchKillSwitchStatus, []);
  const [busy, setBusy] = useState(false);
  const { feedback, notifySuccess, notifyError, clear } = useActionFeedback();
  const [ipInput, setIpInput] = useState('');
  const [drillResult, setDrillResult] = useState(null);

  const reload = () => {
    posture.reload();
    killSwitch.reload();
  };

  const withConfirm = async (label, warningText, action) => {
    if (!window.confirm(warningText)) return;
    setBusy(true);
    clear();
    try {
      const reason = window.prompt(`Reason for ${label} (shown in the audit log):`, '') || '';
      const result = await action(reason);
      notifySuccess(result?.message || `${label} completed.`);
      reload();
    } catch (err) {
      notifyError(err, `Failed to complete ${label}.`);
    } finally {
      setBusy(false);
    }
  };

  const handleBlockIp = async () => {
    if (!ipInput.trim()) return;
    setBusy(true);
    clear();
    try {
      await blockIp(ipInput.trim());
      notifySuccess(`Blocked ${ipInput.trim()}.`);
      setIpInput('');
      reload();
    } catch (err) {
      notifyError(err, 'Failed to block that IP.');
    } finally {
      setBusy(false);
    }
  };

  const handleUnblockIp = async (ip) => {
    setBusy(true);
    clear();
    try {
      await unblockIp(ip);
      notifySuccess(`Unblocked ${ip}.`);
      reload();
    } catch (err) {
      notifyError(err, 'Failed to unblock that IP.');
    } finally {
      setBusy(false);
    }
  };

  const handleDrill = async () => {
    setBusy(true);
    setDrillResult(null);
    clear();
    try {
      const result = await runRecoveryDrill();
      setDrillResult(result);
    } catch (err) {
      notifyError(err, 'Failed to run the recovery drill.');
    } finally {
      setBusy(false);
    }
  };

  if (posture.error || killSwitch.error) {
    return <ErrorState error={posture.error || killSwitch.error} onRetry={reload} />;
  }
  if (posture.loading || killSwitch.loading) {
    return <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading fortress posture…</p>;
  }

  const p = posture.data;
  const ks = killSwitch.data;

  return (
    <div>
      <FeedbackBanner feedback={feedback} onDismiss={clear} />

      {ks.lockdownActive && (
        <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 8, background: 'var(--danger-soft)', color: 'var(--danger)', fontSize: 13, fontWeight: 700 }}>
          CommandCentre is in full lockdown. {ks.lockdownReason ? `Reason: ${ks.lockdownReason}` : ''}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 12 }}>
        <Card title="Posture score" style={{ textAlign: 'center' }}>
          <Gauge value={p.fortressScore} color={scoreColor(p.fortressScore)} />
          <div style={{ marginTop: 4 }}>
            <Badge tone={p.postureBand === 'fortified' ? 'ok' : p.postureBand === 'defensible' ? 'medium' : p.postureBand === 'exposed' ? 'high' : 'critical'}>
              {p.postureBand}
            </Badge>
          </div>
        </Card>

        <Card title="Controls">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {Object.entries(p.controls).map(([key, value]) => (
              <div key={key} style={{ fontSize: 11.5 }}>
                <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>{CONTROL_LABELS[key] || key}</div>
                <Badge tone={CONTROL_TONE[value] || 'medium'}>{value}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Kill switch — CommandCentre self-defense">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
            <p style={{ fontSize: 11.5, fontWeight: 700, margin: '0 0 4px' }}>Revoke all sessions</p>
            <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '0 0 8px' }}>
              Force everyone (including you) to sign in again. No downtime.
            </p>
            <button
              disabled={busy}
              onClick={() =>
                withConfirm(
                  'session revocation',
                  'This will sign out every active session right now, including your own. Continue?',
                  (reason) => revokeAllSessions(reason),
                )
              }
              style={btnStyle('var(--warning)')}
            >
              Revoke everything
            </button>
          </div>

          <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
            <p style={{ fontSize: 11.5, fontWeight: 700, margin: '0 0 4px' }}>Block an IP</p>
            <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '0 0 8px' }}>
              Zero impact on everyone else's traffic.
            </p>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <input
                value={ipInput}
                onChange={(e) => setIpInput(e.target.value)}
                placeholder="1.2.3.4"
                style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', fontSize: 12 }}
              />
              <button disabled={busy} onClick={handleBlockIp} style={btnStyle('var(--accent)')}>
                Block
              </button>
            </div>
            {ks.blockedIps.length > 0 && (
              <div style={{ fontSize: 10.5 }}>
                {ks.blockedIps.map((ip) => (
                  <div key={ip} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                    <span>{ip}</span>
                    <button disabled={busy} onClick={() => handleUnblockIp(ip)} style={{ ...btnStyle('transparent'), padding: '2px 8px', fontSize: 10 }}>
                      unblock
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ border: '1px solid var(--danger)', borderRadius: 8, padding: 12 }}>
            <p style={{ fontSize: 11.5, fontWeight: 700, margin: '0 0 4px', color: 'var(--danger)' }}>Full lockdown</p>
            <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '0 0 8px' }}>
              Last resort. Takes CommandCentre's own API offline. Manual only.
            </p>
            <button
              disabled={busy}
              onClick={() =>
                ks.lockdownActive
                  ? withConfirm('lockdown deactivation', 'Lift the full lockdown?', () => setLockdown(false))
                  : withConfirm(
                      'full lockdown',
                      'This takes CommandCentre\'s own API offline for everyone except login and this control panel. Are you certain?',
                      (reason) => setLockdown(true, reason),
                    )
              }
              style={btnStyle('var(--danger)')}
            >
              {ks.lockdownActive ? 'Lift lockdown' : 'Activate lockdown'}
            </button>
          </div>
        </div>
      </Card>

      <Card title="Recovery drill" right={<button disabled={busy} onClick={handleDrill} style={btnStyle('var(--accent)')}>Run drill</button>}>
        {drillResult ? (
          <div style={{ fontSize: 12 }}>
            <Badge tone={drillResult.exerciseStatus === 'passed' ? 'ok' : drillResult.exerciseStatus === 'warning' ? 'high' : 'critical'}>
              {drillResult.exerciseStatus}
            </Badge>
            <p style={{ margin: '8px 0 0', color: 'var(--text-muted)' }}>{drillResult.message}</p>
          </div>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No drill run this session yet.</p>
        )}
      </Card>

      <Card title="Recommendations">
        {p.recommendations.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No outstanding recommendations.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
            {p.recommendations.map((rec, i) => (
              <li key={i} style={{ marginBottom: 6 }}>{rec}</li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function btnStyle(color) {
  return {
    padding: '6px 12px',
    borderRadius: 6,
    border: `1px solid ${color}`,
    background: color === 'transparent' ? 'transparent' : color,
    color: color === 'transparent' ? 'var(--text-muted)' : 'var(--bg)',
    fontSize: 11.5,
    fontWeight: 600,
    cursor: 'pointer',
    width: '100%',
  };
}
