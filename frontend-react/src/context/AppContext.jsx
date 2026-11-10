import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { SIGNED_OUT_EVENT, api } from '../api.js';

const AppContext = createContext(null);

const SIGNED_OUT = { signedIn: false, roles: [], approverRoles: [], admin: false };

/**
 * Who is signed in (their Google account and roles, from /api/auth/me) and the reference data. Everyone can request
 * bookings; approverRoles decide reviews; admin sees everything and handles service issues.
 */
export function AppProvider({ children }) {
  const [meta, setMeta] = useState({ venues: [], roles: [], outcomes: {}, approval: { timeoutText: '1 day', reminderText: '1 hour' } });
  const [metaError, setMetaError] = useState(null);
  const [user, setUser] = useState(null); // null while asking the backend
  const [authConfig, setAuthConfig] = useState({ googleLoginUrl: '/oauth2/authorization/google', googleConfigured: true, devLogin: false });
  const [authError, setAuthError] = useState(null);
  const [toastState, setToast] = useState(null);
  const toastTimer = useRef();

  const refreshUser = useCallback(async () => {
    try {
      const me = await api('/auth/me');
      setUser(me.signedIn ? me : SIGNED_OUT);
      setAuthError(null);
    } catch (e) {
      setUser(SIGNED_OUT);
      setAuthError(e);
    }
  }, []);

  useEffect(() => {
    refreshUser();
    api('/auth/config').then(setAuthConfig).catch(() => {});
    const onSignedOut = () => setUser(SIGNED_OUT);
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
  }, [refreshUser]);

  useEffect(() => {
    if (user?.signedIn) api('/meta').then(setMeta).catch(setMetaError);
  }, [user?.signedIn]);

  const toast = useCallback((message, tone = '') => {
    clearTimeout(toastTimer.current);
    setToast({ message, tone });
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      setUser(SIGNED_OUT);
      window.location.hash = '#/';
    }
  }, []);

  const value = useMemo(() => {
    const u = user || SIGNED_OUT;
    const isAdmin = !!u.admin;
    const isApprover = (u.approverRoles || []).length > 0;
    return {
      meta,
      metaError,
      user: u,
      loadingUser: user === null,
      authConfig,
      authError,
      refreshUser,
      signOut,
      isAdmin,
      isApprover,
      /** Shown in the header: admin first, then the approver roles. */
      kind: isAdmin ? 'admin' : isApprover ? 'approver' : 'requester',
      venue: (id) => meta.venues.find((v) => v.id === id),
      venueName: (id) => meta.venues.find((v) => v.id === id)?.name || id || '',
      roleName: (id) => (id === 'admin' ? 'Admin' : meta.roles.find((r) => r.id === id)?.name || id || ''),
      toast,
    };
  }, [meta, metaError, user, authConfig, authError, refreshUser, signOut, toast]);

  return (
    <AppContext.Provider value={value}>
      {children}
      {toastState && (
        <div role="status" className={`fixed bottom-6 left-1/2 z-20 -translate-x-1/2 rounded-lg px-4 py-3 font-semibold shadow-xl ${toastState.tone === 'bad' ? 'bg-bad text-white' : 'bg-ink text-paper'}`}>
          {toastState.message}
        </div>
      )}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
