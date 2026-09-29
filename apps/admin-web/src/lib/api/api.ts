import { createAuthStore } from '../auth/auth-store';
import { impersonationStore } from '../auth/impersonation-store';
import { env } from '../env';
import { ApiClient } from './client';
import { createTokenStore } from './token-store';

/** App-wide singletons: token persistence, auth state and the HTTP client. */
export const tokenStore = createTokenStore();
export const authStore = createAuthStore(tokenStore);

export const api = new ApiClient({
  baseUrl: env.apiBaseUrl,
  tokens: tokenStore,
  onAuthLost: (reason) => {
    impersonationStore.end();
    authStore.setState({
      status: 'anonymous',
      admin: null,
      lastLogoutReason: reason === 'refresh_failed' ? 'expired' : 'revoked',
    });
  },
});
