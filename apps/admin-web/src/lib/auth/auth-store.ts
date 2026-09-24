import type { AdminMe } from '@rap/shared';
import { createTokenStore, type TokenStore } from '../api/token-store';

export type AuthStatus = 'booting' | 'authenticated' | 'anonymous';

export interface AuthState {
  status: AuthStatus;
  admin: AdminMe | null;
  /** Why the last session ended (shown on the login page). */
  lastLogoutReason: 'manual' | 'expired' | 'revoked' | null;
}

type Listener = () => void;

export interface AuthStore {
  tokens: TokenStore;
  getState(): AuthState;
  setState(patch: Partial<AuthState>): void;
  subscribe(listener: Listener): () => void;
}

export function createAuthStore(tokens: TokenStore = createTokenStore()): AuthStore {
  let state: AuthState = { status: tokens.get() ? 'booting' : 'anonymous', admin: null, lastLogoutReason: null };
  const listeners = new Set<Listener>();
  return {
    tokens,
    getState: () => state,
    setState: (patch) => {
      state = { ...state, ...patch };
      listeners.forEach((l) => l());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
