import type { AuthTokens, CookieModeAuthTokens } from '@rap/shared';
import { STORAGE_PREFIX } from '../brand';

export interface StoredTokens {
  accessToken: string;
  /**
   * Phase 5 (#16): the console runs in cookie mode - the refresh token lives in the API's httpOnly `rap_refresh`
   * cookie and is never in JS-readable storage. Kept optional only for sessions stored before the switch.
   */
  refreshToken?: string | null;
  /** Epoch ms when the access token expires (client clock). */
  expiresAt: number;
}

export interface TokenStore {
  get(): StoredTokens | null;
  set(tokens: AuthTokens | CookieModeAuthTokens): StoredTokens;
  clear(): void;
  subscribe(listener: () => void): () => void;
}

const KEY = `${STORAGE_PREFIX}.tokens`;

function readStorage(storage: Storage | null): StoredTokens | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredTokens>;
    if (typeof parsed.accessToken !== 'string') return null;
    return { accessToken: parsed.accessToken, refreshToken: null, expiresAt: Number(parsed.expiresAt) || 0 };
  } catch {
    return null;
  }
}

/**
 * Only the short-lived access token is kept in memory and mirrored to localStorage so a reload keeps the session
 * until the next refresh; the long-lived refresh token is an httpOnly cookie owned by the API (security audit #16).
 */
export function createTokenStore(storage: Storage | null = typeof localStorage !== 'undefined' ? localStorage : null): TokenStore {
  let current = readStorage(storage);
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());

  if (storage && typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key === KEY) {
        current = readStorage(storage);
        notify();
      }
    });
  }

  return {
    get: () => current,
    set: (tokens) => {
      current = {
        accessToken: tokens.accessToken,
        refreshToken: null,
        expiresAt: Date.now() + Math.max(0, tokens.expiresIn) * 1000,
      };
      try {
        storage?.setItem(KEY, JSON.stringify({ accessToken: current.accessToken, expiresAt: current.expiresAt }));
      } catch {
        /* storage full / disabled - keep in memory */
      }
      notify();
      return current;
    },
    clear: () => {
      current = null;
      try {
        storage?.removeItem(KEY);
      } catch {
        /* ignore */
      }
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
