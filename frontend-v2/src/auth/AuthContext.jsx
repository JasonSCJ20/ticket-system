import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import * as authApi from '../api/auth.js';
import { getToken, setUnauthorizedHandler } from '../api/client.js';

const AuthContext = createContext(null);

function decodeTokenPayload(token) {
  if (!token) return null;
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [payload, setPayload] = useState(() => decodeTokenPayload(getToken()));
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(!!getToken());

  const isAuthenticated = !!payload;

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setPayload(null);
      setProfile(null);
    });
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    authApi
      .fetchMe()
      .then((data) => {
        if (!cancelled) setProfile(data?.user || data || null);
      })
      .catch(() => {
        if (!cancelled) setProfile(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Only re-fetch when the auth boundary itself changes, not on every payload identity churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  const login = async (username, password, mfaCode) => {
    const result = await authApi.login(username, password, mfaCode);
    if (result.mfaRequired) return result;
    setPayload(decodeTokenPayload(getToken()));
    return result;
  };

  const logout = async () => {
    await authApi.logout().catch(() => {});
    setPayload(null);
    setProfile(null);
  };

  const value = useMemo(
    () => ({
      isAuthenticated,
      loading,
      role: payload?.role || null,
      audienceCode: profile?.audienceCode || null,
      username: payload?.username || null,
      profile,
      profileCompletionRequired: !!profile?.profileCompletionRequired,
      login,
      logout,
      setProfile,
    }),
    [isAuthenticated, loading, payload, profile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
