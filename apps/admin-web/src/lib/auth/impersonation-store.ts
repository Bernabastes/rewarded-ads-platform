import type { ImpersonationTokenResponse } from '@rap/shared';
import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * Read-only impersonation ("view as user") session. The token lives ONLY in this module's memory: it is never
 * written to localStorage, never attached to the admin API client and dies with the tab / on logout.
 */
export interface ImpersonationSession {
  token: string;
  /** Epoch ms. */
  issuedAt: number;
  expiresAt: number;
  user: ImpersonationTokenResponse['user'];
  actorAdminId: string;
  reason: string;
}

export type ImpersonationState =
  | { status: 'idle'; session: null }
  | { status: 'active'; session: ImpersonationSession }
  | { status: 'expired'; session: ImpersonationSession };

type Listener = () => void;

function createImpersonationStore() {
  let state: ImpersonationState = { status: 'idle', session: null };
  const listeners = new Set<Listener>();
  let expiryTimer: number | null = null;

  const emit = () => listeners.forEach((l) => l());
  const clearTimer = () => {
    if (expiryTimer !== null) {
      window.clearTimeout(expiryTimer);
      expiryTimer = null;
    }
  };

  const markExpired = () => {
    clearTimer();
    if (state.status !== 'active') return;
    state = { status: 'expired', session: { ...state.session, token: '' } };
    emit();
  };

  return {
    getState: () => state,
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Replace any current session with a freshly issued token. */
    start(res: ImpersonationTokenResponse, reason: string, now = Date.now()) {
      clearTimer();
      const expiresAt = Number.isFinite(Date.parse(res.expiresAt)) ? Date.parse(res.expiresAt) : now + res.expiresIn * 1000;
      state = {
        status: 'active',
        session: { token: res.accessToken, issuedAt: now, expiresAt, user: res.user, actorAdminId: res.actorAdminId, reason },
      };
      expiryTimer = window.setTimeout(markExpired, Math.max(0, expiresAt - now));
      emit();
    },
    /** Server said the token is no longer valid (401) - same as the timer firing. */
    markExpired,
    /** Explicit end / dismiss: forget everything. */
    end() {
      clearTimer();
      if (state.status === 'idle') return;
      state = { status: 'idle', session: null };
      emit();
    },
  };
}

export type ImpersonationStore = ReturnType<typeof createImpersonationStore>;

export const impersonationStore: ImpersonationStore = createImpersonationStore();

export function useImpersonation(): ImpersonationState {
  return useSyncExternalStore(impersonationStore.subscribe, impersonationStore.getState, impersonationStore.getState);
}

/** Milliseconds left on the active session, ticking once a second (0 when idle / expired). */
export function useImpersonationCountdown(): number {
  const state = useImpersonation();
  const expiresAt = state.status === 'active' ? state.session.expiresAt : null;
  const [remaining, setRemaining] = useState(() => (expiresAt ? Math.max(0, expiresAt - Date.now()) : 0));
  useEffect(() => {
    if (!expiresAt) {
      setRemaining(0);
      return;
    }
    const tick = () => setRemaining(Math.max(0, expiresAt - Date.now()));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [expiresAt]);
  return remaining;
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
