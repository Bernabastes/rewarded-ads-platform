import type { AuthTokens } from '@rap/shared';
import { STORAGE_PREFIX } from '../brand';

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token expires (client clock). */
  expiresAt: number;
}

export interface TokenStore {
  get(): StoredTokens | null;
  set(tokens: AuthTokens): StoredTokens;
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
    if (typeof parsed.accessToken !== 'string' || typeof parsed.refreshToken !== 'string') return null;
    return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken, expiresAt: Number(parsed.expiresAt) || 0 };
  } catch {
    return null;
  }
}

/**
 * Tokens live in memory and are mirrored to localStorage so a reload keeps the session.
 * (Internal tool trade-off; see README "Security notes".)
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
        refreshToken: tokens.refreshToken,
        expiresAt: Date.now() + Math.max(0, tokens.expiresIn) * 1000,
      };
      try {
        storage?.setItem(KEY, JSON.stringify(current));
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
