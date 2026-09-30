import { ApiClient } from '@/api/client';
import { blockedReasonFromCode, useAuthStore } from '@/auth/authStore';
import { tokenStore } from '@/auth/tokenStore';
import { API_URL } from '@/config';

/** Singleton API client wired to secure token storage and the auth store. */
export const api = new ApiClient({
  baseUrl: API_URL,
  tokenStore,
  onAuthFailure: (code) => {
    useAuthStore.getState().signOut(code);
  },
  onAccountBlocked: (code) => {
    const reason = blockedReasonFromCode(code);
    if (reason) useAuthStore.getState().setBlocked(reason);
  },
  onConsentRequired: (kinds) => {
    useAuthStore.getState().requireConsent(kinds);
  },
});
