import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { useActionFeedback } from '../hooks/useActionFeedback.js';
import { updateProfile, fetchMfaSetup, enableMfa, disableMfa } from '../api/auth.js';
import { setToken } from '../api/client.js';
import { Card, Chip, FeedbackBanner } from '../components/ui.jsx';

const AUDIENCE_OPTIONS = [
  { value: 'STAFF', label: 'Operational staff' },
  { value: 'TJN', label: 'CommandCentre manager' },
  { value: 'GJN', label: 'Operational manager' },
  { value: 'BJN', label: 'Executive' },
  { value: 'DGSN', label: 'Stakeholder' },
];
const TEAM_OPTIONS = ['Network', 'Developer', 'Hardware'];

const inputStyle = {
  width: '100%',
  padding: '7px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'var(--text)',
  fontSize: 13,
  marginBottom: 10,
};

// Plain bordered buttons match the rest of the redesigned app — only a
// genuinely primary action (save, confirm) gets a filled background.
function btnStyle(color, outline = true) {
  return {
    padding: '7px 14px',
    borderRadius: 6,
    border: `1px solid ${color}`,
    background: outline ? 'transparent' : color,
    color: outline ? color : 'var(--bg)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
  };
}

export default function Settings() {
  const { profile, setProfile } = useAuth();
  const [form, setForm] = useState({
    audienceCode: profile?.audienceCode || 'STAFF',
    telegramNumber: profile?.telegramNumber || '',
    telegramChatId: profile?.telegramChatId || '',
    operationalTeams: profile?.operationalTeams || [],
  });
  const [busy, setBusy] = useState(false);
  const { feedback, notifySuccess, notifyError, clear } = useActionFeedback();
  const [mfaSetup, setMfaSetup] = useState(null);
  const [mfaCode, setMfaCode] = useState('');

  const isStaff = form.audienceCode === 'STAFF';

  const toggleTeam = (team) => {
    setForm((f) => {
      const has = f.operationalTeams.includes(team);
      const next = has ? f.operationalTeams.filter((t) => t !== team) : [...f.operationalTeams, team].slice(-2);
      return { ...f, operationalTeams: next };
    });
  };

  const handleSaveProfile = async () => {
    setBusy(true);
    clear();
    try {
      const result = await updateProfile({
        audienceCode: form.audienceCode,
        telegramNumber: isStaff ? form.telegramNumber.trim() : undefined,
        telegramChatId: isStaff ? form.telegramChatId.trim() : undefined,
        operationalTeams: isStaff ? form.operationalTeams : [],
      });
      if (result.access_token) setToken(result.access_token);
      setProfile((p) => ({ ...p, ...result }));
      notifySuccess('Profile updated.');
    } catch (err) {
      notifyError(err, 'Failed to update your profile.');
    } finally {
      setBusy(false);
    }
  };

  const handleStartMfaSetup = async () => {
    setBusy(true);
    clear();
    try {
      const result = await fetchMfaSetup();
      setMfaSetup(result);
    } catch (err) {
      notifyError(err, 'Failed to start MFA setup.');
    } finally {
      setBusy(false);
    }
  };

  const handleEnableMfa = async () => {
    if (!mfaCode.trim()) return;
    setBusy(true);
    clear();
    try {
      await enableMfa(mfaCode.trim());
      notifySuccess('MFA enabled.');
      setMfaSetup(null);
      setMfaCode('');
      setProfile((p) => ({ ...p, mfaEnabled: true }));
    } catch (err) {
      notifyError(err, 'That code was not accepted. Check your authenticator app and try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleDisableMfa = async () => {
    const code = window.prompt('Enter your current MFA code to disable it:');
    if (!code) return;
    setBusy(true);
    clear();
    try {
      await disableMfa(code.trim());
      notifySuccess('MFA disabled.');
      setProfile((p) => ({ ...p, mfaEnabled: false }));
    } catch (err) {
      notifyError(err, 'Failed to disable MFA.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <FeedbackBanner feedback={feedback} onDismiss={clear} />

      <Card title="Profile" style={{ padding: '1.25rem' }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0, marginBottom: 12 }}>
          {profile?.name} {profile?.surname} · {profile?.email}
        </p>
        <select value={form.audienceCode} onChange={(e) => setForm({ ...form, audienceCode: e.target.value })} style={inputStyle}>
          {AUDIENCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        {isStaff && (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              {TEAM_OPTIONS.map((team) => (
                <button
                  key={team}
                  onClick={() => toggleTeam(team)}
                  style={btnStyle('var(--accent)', !form.operationalTeams.includes(team))}
                >
                  {team}
                </button>
              ))}
            </div>
            <input placeholder="Telegram phone number" value={form.telegramNumber} onChange={(e) => setForm({ ...form, telegramNumber: e.target.value })} style={inputStyle} />
            <input placeholder="Telegram chat ID" value={form.telegramChatId} onChange={(e) => setForm({ ...form, telegramChatId: e.target.value })} style={inputStyle} />
          </>
        )}

        <button disabled={busy} onClick={handleSaveProfile} style={btnStyle('var(--accent)', false)}>
          Save profile
        </button>
      </Card>

      <Card title="Two-factor authentication" right={<Chip tone={profile?.mfaEnabled ? 'accent' : 'muted'}>{profile?.mfaEnabled ? 'enabled' : 'disabled'}</Chip>} style={{ padding: '1.25rem' }}>
        {profile?.mfaEnabled ? (
          <button disabled={busy} onClick={handleDisableMfa} style={btnStyle('var(--danger)')}>
            Disable MFA
          </button>
        ) : mfaSetup ? (
          <div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Scan this into your authenticator app, or enter the secret manually:</p>
            <code style={{ display: 'block', fontSize: 12.5, wordBreak: 'break-all', background: 'var(--surface-2)', padding: 10, borderRadius: 6, marginBottom: 10 }}>
              {mfaSetup.secret}
            </code>
            <input value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} placeholder="6-digit code" style={inputStyle} />
            <button disabled={busy} onClick={handleEnableMfa} style={btnStyle('var(--success)', false)}>
              Confirm and enable
            </button>
          </div>
        ) : (
          <button disabled={busy} onClick={handleStartMfaSetup} style={btnStyle('var(--accent)', false)}>
            Set up MFA
          </button>
        )}
      </Card>
    </div>
  );
}
