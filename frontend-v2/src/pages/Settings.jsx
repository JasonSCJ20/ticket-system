import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { updateProfile, fetchMfaSetup, enableMfa, disableMfa } from '../api/auth.js';
import { setToken } from '../api/client.js';
import { Card, Badge } from '../components/ui.jsx';

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
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'var(--text)',
  fontSize: 12,
  marginBottom: 8,
};

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

export default function Settings() {
  const { profile, setProfile } = useAuth();
  const [form, setForm] = useState({
    audienceCode: profile?.audienceCode || 'STAFF',
    telegramNumber: profile?.telegramNumber || '',
    telegramChatId: profile?.telegramChatId || '',
    operationalTeams: profile?.operationalTeams || [],
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [mfaSetup, setMfaSetup] = useState(null);
  const [mfaCode, setMfaCode] = useState('');

  const isStaff = form.audienceCode === 'STAFF';
  const note = (tone, text) => setMessage({ tone, text });

  const toggleTeam = (team) => {
    setForm((f) => {
      const has = f.operationalTeams.includes(team);
      const next = has ? f.operationalTeams.filter((t) => t !== team) : [...f.operationalTeams, team].slice(-2);
      return { ...f, operationalTeams: next };
    });
  };

  const handleSaveProfile = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await updateProfile({
        audienceCode: form.audienceCode,
        telegramNumber: isStaff ? form.telegramNumber.trim() : undefined,
        telegramChatId: isStaff ? form.telegramChatId.trim() : undefined,
        operationalTeams: isStaff ? form.operationalTeams : [],
      });
      if (result.access_token) setToken(result.access_token);
      setProfile((p) => ({ ...p, ...result }));
      note('ok', 'Profile updated.');
    } catch (err) {
      note('critical', err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleStartMfaSetup = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await fetchMfaSetup();
      setMfaSetup(result);
    } catch (err) {
      note('critical', err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleEnableMfa = async () => {
    if (!mfaCode.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      await enableMfa(mfaCode.trim());
      note('ok', 'MFA enabled.');
      setMfaSetup(null);
      setMfaCode('');
      setProfile((p) => ({ ...p, mfaEnabled: true }));
    } catch (err) {
      note('critical', err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDisableMfa = async () => {
    const code = window.prompt('Enter your current MFA code to disable it:');
    if (!code) return;
    setBusy(true);
    setMessage(null);
    try {
      await disableMfa(code.trim());
      note('ok', 'MFA disabled.');
      setProfile((p) => ({ ...p, mfaEnabled: false }));
    } catch (err) {
      note('critical', err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {message && (
        <div
          style={{
            marginBottom: 12,
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

      <Card title="Profile">
        <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 0 }}>
          {profile?.name} {profile?.surname} · {profile?.email}
        </p>
        <select value={form.audienceCode} onChange={(e) => setForm({ ...form, audienceCode: e.target.value })} style={inputStyle}>
          {AUDIENCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        {isStaff && (
          <>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
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

        <button disabled={busy} onClick={handleSaveProfile} style={btnStyle('var(--accent)')}>
          Save profile
        </button>
      </Card>

      <Card title="Two-factor authentication" right={<Badge tone={profile?.mfaEnabled ? 'ok' : 'low'}>{profile?.mfaEnabled ? 'enabled' : 'disabled'}</Badge>}>
        {profile?.mfaEnabled ? (
          <button disabled={busy} onClick={handleDisableMfa} style={btnStyle('var(--danger)', true)}>
            Disable MFA
          </button>
        ) : mfaSetup ? (
          <div>
            <p style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Scan this into your authenticator app, or enter the secret manually:</p>
            <code style={{ display: 'block', fontSize: 11, wordBreak: 'break-all', background: 'var(--surface-2)', padding: 8, borderRadius: 6, marginBottom: 8 }}>
              {mfaSetup.secret}
            </code>
            <input value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} placeholder="6-digit code" style={inputStyle} />
            <button disabled={busy} onClick={handleEnableMfa} style={btnStyle('var(--success)')}>
              Confirm and enable
            </button>
          </div>
        ) : (
          <button disabled={busy} onClick={handleStartMfaSetup} style={btnStyle('var(--accent)')}>
            Set up MFA
          </button>
        )}
      </Card>
    </div>
  );
}
