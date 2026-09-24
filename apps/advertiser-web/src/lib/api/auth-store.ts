import type { AdvertiserProfile, AuthTokens } from '@rap/shared';

export interface AuthSession {
  tokens: AuthTokens;
  profile: AdvertiserProfile;
  /** ms epoch when the access token expires (derived from the JWT `exp` claim or `expiresIn`). */
  accessTokenExpiresAt: number;
}

export interface AuthState {
  status: 'anonymous' | 'authenticated';
  session: AuthSession | null;
}

export const AUTH_STORAGE_KEY = 'gize.auth.session';
const REMEMBER_KEY = 'gize.auth.remember';

type Listener = () => void;

const listeners = new Set<Listener>();
const expiryListeners = new Set<(reason: string) => void>();

function safeStorage(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function readSession(): AuthSession | null {
  for (const kind of ['local', 'session'] as const) {
    const raw = safeStorage(kind)?.getItem(AUTH_STORAGE_KEY);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as AuthSession;
      if (parsed?.tokens?.accessToken && parsed?.profile?.id) return parsed;
    } catch {
      safeStorage(kind)?.removeItem(AUTH_STORAGE_KEY);
    }
  }
  return null;
}

let state: AuthState = (() => {
  const session = typeof window === 'undefined' ? null : readSession();
  return { status: session ? 'authenticated' : 'anonymous', session };
})();

function emit() {
  for (const listener of listeners) listener();
}

function persist(session: AuthSession | null) {
  const remember = safeStorage('local')?.getItem(REMEMBER_KEY) !== 'false';
  const target = remember ? safeStorage('local') : safeStorage('session');
  safeStorage('local')?.removeItem(AUTH_STORAGE_KEY);
  safeStorage('session')?.removeItem(AUTH_STORAGE_KEY);
  if (session) target?.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

/** Decode the `exp` claim of a JWT without verifying it (informational only). */
export function decodeJwtExpiry(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const claims = JSON.parse(json) as { exp?: number };
    return typeof claims.exp === 'number' ? claims.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function computeExpiry(tokens: AuthTokens, now = Date.now()): number {
  return decodeJwtExpiry(tokens.accessToken) ?? now + tokens.expiresIn * 1000;
}

export const authStore = {
  getState(): AuthState {
    return state;
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  onSessionExpired(listener: (reason: string) => void): () => void {
    expiryListeners.add(listener);
    return () => expiryListeners.delete(listener);
  },
  setRemember(remember: boolean) {
    safeStorage('local')?.setItem(REMEMBER_KEY, remember ? 'true' : 'false');
  },
  signIn(tokens: AuthTokens, profile: AdvertiserProfile, remember = true) {
    authStore.setRemember(remember);
    const session: AuthSession = { tokens, profile, accessTokenExpiresAt: computeExpiry(tokens) };
    state = { status: 'authenticated', session };
    persist(session);
    emit();
  },
  setTokens(tokens: AuthTokens) {
    if (!state.session) return;
    const session: AuthSession = { ...state.session, tokens, accessTokenExpiresAt: computeExpiry(tokens) };
    state = { status: 'authenticated', session };
    persist(session);
    emit();
  },
  updateProfile(patch: Partial<AdvertiserProfile>) {
    if (!state.session) return;
    const session: AuthSession = { ...state.session, profile: { ...state.session.profile, ...patch } };
    state = { status: 'authenticated', session };
    persist(session);
    emit();
  },
  getTokens(): AuthTokens | null {
    return state.session?.tokens ?? null;
  },
  clear() {
    state = { status: 'anonymous', session: null };
    persist(null);
    emit();
  },
  /** Called by the API client when a refresh fails: clears the session and notifies the UI. */
  expire(reason: string) {
    const wasAuthenticated = state.status === 'authenticated';
    authStore.clear();
    if (wasAuthenticated) for (const listener of expiryListeners) listener(reason);
  },
  /** Adopt tokens written by another tab (single-use refresh tokens rotate). */
  syncFromStorage() {
    const session = readSession();
    const current = state.session;
    if (!session && current) {
      state = { status: 'anonymous', session: null };
      emit();
      return;
    }
    if (session && session.tokens.accessToken !== current?.tokens.accessToken) {
      state = { status: 'authenticated', session };
      emit();
    }
  },
  /** Test helper. */
  __reset() {
    state = { status: 'anonymous', session: null };
    persist(null);
    listeners.clear();
    expiryListeners.clear();
  },
};

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === AUTH_STORAGE_KEY || event.key === null) authStore.syncFromStorage();
  });
}
