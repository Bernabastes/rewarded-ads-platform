import type { OtpVerifyResponse, UserProfile } from '@rap/shared';

import { authApi } from '@/api/endpoints/auth';
import { usersApi } from '@/api/endpoints/users';
import { isApiError } from '@/api/errors';
import { queryClient } from '@/api/queryClient';
import { registerPushToken } from '@/notifications/push';
import { secureStorage, type KeyValueStorage } from '@/utils/storage';

import { useAuthStore } from './authStore';
import { tokenStore } from './tokenStore';

const USER_CACHE_KEY = 'gize.auth.userCache.v1';

async function readCachedUser(storage: KeyValueStorage): Promise<UserProfile | null> {
  try {
    const raw = await storage.getItem(USER_CACHE_KEY);
    return raw ? (JSON.parse(raw) as UserProfile) : null;
  } catch {
    return null;
  }
}

export async function cacheUser(user: UserProfile | null, storage: KeyValueStorage = secureStorage) {
  if (user) await storage.setItem(USER_CACHE_KEY, JSON.stringify(user));
  else await storage.removeItem(USER_CACHE_KEY);
}

/**
 * Restores the session at launch: with stored tokens we validate them against `/users/me`.
 * A network failure keeps the user signed in with the cached profile (offline launch); an auth
 * failure signs them out.
 */
export async function hydrateAuth(storage: KeyValueStorage = secureStorage): Promise<void> {
  const store = useAuthStore.getState();
  const tokens = await tokenStore.get();
  if (!tokens) {
    store.setHydrated(null);
    return;
  }
  try {
    const user = await usersApi.me();
    await cacheUser(user, storage);
    store.setHydrated(user);
  } catch (error) {
    if (isApiError(error) && (error.statusCode === 401 || error.statusCode === 403)) {
      if (error.statusCode === 403) {
        // Blocked account: keep the session so the blocking screen can explain and offer sign-out.
        const cached = await readCachedUser(storage);
        store.setHydrated(cached);
        return;
      }
      await tokenStore.set(null);
      await cacheUser(null, storage);
      store.setHydrated(null);
      return;
    }
    const cached = await readCachedUser(storage);
    store.setHydrated(cached);
  }
}

/** After a successful OTP verification: persist, enter the app, register push (best effort). */
export async function completeSignIn(result: OtpVerifyResponse, deviceId?: string): Promise<void> {
  await cacheUser(result.user);
  useAuthStore.getState().signIn(result.user);
  void registerPushToken(deviceId);
}

export async function applyUserUpdate(user: UserProfile): Promise<void> {
  await cacheUser(user);
  useAuthStore.getState().setUser(user);
}

export async function signOutEverywhere(): Promise<void> {
  await authApi.logout();
  await cacheUser(null);
  queryClient.clear();
  useAuthStore.getState().signOut();
}
