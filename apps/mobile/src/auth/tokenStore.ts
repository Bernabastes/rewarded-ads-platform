import type { AuthTokens } from '@rap/shared';

import type { TokenStore } from '@/api/client';
import { secureStorage, type KeyValueStorage } from '@/utils/storage';

const TOKENS_KEY = 'gize.auth.tokens.v1';

/** Tokens live in Keychain/Keystore (SecureStore); an in-memory copy avoids a storage read per request. */
export function createTokenStore(storage: KeyValueStorage = secureStorage): TokenStore & { clearCache(): void } {
  let cache: AuthTokens | null | undefined;
  return {
    async get() {
      if (cache !== undefined) return cache;
      const raw = await storage.getItem(TOKENS_KEY);
      if (!raw) {
        cache = null;
        return null;
      }
      try {
        const parsed = JSON.parse(raw) as AuthTokens;
        cache = parsed?.accessToken && parsed?.refreshToken ? parsed : null;
      } catch {
        cache = null;
      }
      return cache;
    },
    async set(tokens) {
      cache = tokens;
      if (tokens) await storage.setItem(TOKENS_KEY, JSON.stringify(tokens));
      else await storage.removeItem(TOKENS_KEY);
    },
    clearCache() {
      cache = undefined;
    },
  };
}

export const tokenStore = createTokenStore();
