import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import * as authApi from '../api/auth.js';
import { setUnauthorizedHandler } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const isAuthenticated = !!profile;

  // The auth token now lives in an httpOnly cookie the browser attaches
  // automatically — there's nothing for this code to read client-side, so
  // the only way to learn "is there already a session" is to ask the
  // server. GET /me both answers that and supplies role/username in one
  // round trip, replacing the old client-side JWT decode.
  const loadProfile = () =>
    authApi
      .fetchMe()
      .then((data) => setProfile(data || null))
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setProfile(null);
    });
  }, []);

  useEffect(() => {
    loadProfile();
    // Only ever on mount — login()/logout() below drive subsequent changes explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async (username, password, mfaCode) => {
    const result = await authApi.login(username, password, mfaCode);
    if (result.mfaRequired) return result;
    await loadProfile();
    return result;
  };

  const logout = async () => {
    await authApi.logout().catch(() => {});
    setProfile(null);
  };

  const value = useMemo(
    () => ({
      isAuthenticated,
      loading,
      role: profile?.role || null,
      audienceCode: profile?.audienceCode || null,
      username: profile?.username || null,
      profile,
      profileCompletionRequired: !!profile?.profileCompletionRequired,
      login,
      logout,
      setProfile,
    }),
    [isAuthenticated, loading, profile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
