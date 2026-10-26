import { useCallback, useEffect, useState } from 'react';
import { ApiUser, apiClients, AppRole, SessionResponse } from './api';

export interface OtpRequested {
  expiresAt: string;
  resendAvailableAt: string;
}

export type AuthStatus = 'checking' | 'signedIn' | 'signedOut';

/** Session state for one app (customer or driver), restored from the refresh cookie on load. */
export function useAuth(role: AppRole) {
  const client = apiClients[role];
  const [status, setStatus] = useState<AuthStatus>('checking');
  const [user, setUser] = useState<ApiUser | null>(null);

  useEffect(() => {
    let active = true;
    client
      .refresh()
      .then((session) => {
        if (!active) return;
        setUser(session?.user ?? null);
        setStatus(session ? 'signedIn' : 'signedOut');
      })
      .catch(() => active && setStatus('signedOut'));
    return () => {
      active = false;
    };
  }, [client]);

  const requestOtp = useCallback(
    (phone: string) =>
      client.request<OtpRequested>('/auth/otp/request', {
        method: 'POST',
        body: { phone },
        auth: false,
      }),
    [client],
  );

  const verifyOtp = useCallback(
    async (phone: string, code: string) => {
      const session = await client.request<SessionResponse>('/auth/otp/verify', {
        method: 'POST',
        body: { phone, code, role },
        auth: false,
      });
      client.setSession(session);
      setUser(session.user);
      setStatus('signedIn');
      return session;
    },
    [client, role],
  );

  const logout = useCallback(async () => {
    try {
      await client.request<void>('/auth/logout', { method: 'POST' });
    } finally {
      // Even if the network call fails, forget the session locally.
      client.setSession(null);
      setUser(null);
      setStatus('signedOut');
    }
  }, [client]);

  return { status, user, setUser, requestOtp, verifyOtp, logout, client };
}
