import { type AdminAuthResponse, type AdminMe, type AdminMfaChallengeResponse, isAdminMfaChallenge } from '@rap/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { api, authStore } from '../api/api';
import { authApi } from '../api/endpoints';
import { isApiError } from '../api/errors';
import type { AuthState } from './auth-store';
import { impersonationStore } from './impersonation-store';
import { type AccessKey, can, type Role } from './rbac';

export function useAuthState(): AuthState {
  return useSyncExternalStore(authStore.subscribe, authStore.getState, authStore.getState);
}

export interface AuthApi {
  state: AuthState;
  admin: AdminMe | null;
  role: Role | null;
  can: (key: AccessKey) => boolean;
  /** Resolves to the profile, or to an MFA challenge that must be completed with `completeMfaLogin`. */
  login: (email: string, password: string) => Promise<AdminMe | AdminMfaChallengeResponse>;
  completeMfaLogin: (mfaToken: string, code: string) => Promise<AdminMe>;
  logout: (reason?: AuthState['lastLogoutReason']) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

export function useAuth(): AuthApi {
  const state = useAuthState();
  const queryClient = useQueryClient();

  const finishLogin = useCallback(async (res: AdminAuthResponse) => {
    authStore.tokens.set(res.tokens);
    // The login payload lacks `permissions`; /admin/me is the single source of truth for role data.
    const me = await authApi.me();
    authStore.setState({ status: 'authenticated', admin: me, lastLogoutReason: null });
    return me;
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await authApi.login(email, password);
      if (isAdminMfaChallenge(res)) return res;
      return finishLogin(res);
    },
    [finishLogin],
  );

  const completeMfaLogin = useCallback(
    async (mfaToken: string, code: string) => finishLogin(await authApi.loginMfa(mfaToken, code)),
    [finishLogin],
  );

  const logout = useCallback(
    async (reason: AuthState['lastLogoutReason'] = 'manual') => {
      const tokens = authStore.tokens.get();
      authStore.tokens.clear();
      impersonationStore.end();
      authStore.setState({ status: 'anonymous', admin: null, lastLogoutReason: reason });
      queryClient.clear();
      if (tokens?.refreshToken) {
        try {
          await authApi.logout(tokens.refreshToken);
        } catch {
          /* best effort */
        }
      }
    },
    [queryClient],
  );

  const refreshProfile = useCallback(async () => {
    const me = await authApi.me();
    authStore.setState({ admin: me, status: 'authenticated' });
  }, []);

  const role = state.admin?.role ?? null;
  return {
    state,
    admin: state.admin,
    role,
    can: (key) => can(role, key),
    login,
    completeMfaLogin,
    logout,
    refreshProfile,
  };
}

/**
 * Restores the session on boot: with persisted tokens we fetch /admin/me (the client refreshes silently
 * if the access token is stale). Any auth failure lands on the login page with a reason.
 */
export function useAuthBootstrap(): void {
  const { status } = useAuthState();
  useEffect(() => {
    if (status !== 'booting') return;
    let cancelled = false;
    (async () => {
      try {
        if (!authStore.tokens.get()) {
          authStore.setState({ status: 'anonymous', admin: null });
          return;
        }
        const me = await authApi.me();
        if (!cancelled) authStore.setState({ status: 'authenticated', admin: me, lastLogoutReason: null });
      } catch (err) {
        if (cancelled) return;
        if (isApiError(err) && err.isNetwork) {
          // Keep tokens; show login with a hint rather than dropping the session on a blip.
          authStore.setState({ status: 'anonymous', admin: null, lastLogoutReason: null });
          return;
        }
        authStore.tokens.clear();
        authStore.setState({ status: 'anonymous', admin: null, lastLogoutReason: 'expired' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  // Keep the session warm: refresh shortly before the access token expires while the tab is open.
  useEffect(() => {
    if (status !== 'authenticated') return;
    const id = window.setInterval(() => {
      const t = authStore.tokens.get();
      if (t && t.expiresAt - Date.now() < 60_000) void api.refresh();
    }, 30_000);
    return () => window.clearInterval(id);
  }, [status]);
}
