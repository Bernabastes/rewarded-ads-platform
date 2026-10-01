import type { AdvertiserProfile, AdvertiserRegisterDto, EmailPasswordLoginDto } from '@rap/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { authApi } from '@/lib/api';
import { authStore, type AuthState } from '@/lib/api/auth-store';
import { describeApiError } from '@/lib/api/errors';

interface AuthContextValue {
  state: AuthState;
  profile: AdvertiserProfile | null;
  isAuthenticated: boolean;
  isVerified: boolean;
  login: (dto: EmailPasswordLoginDto, remember: boolean) => Promise<AdvertiserProfile>;
  register: (dto: AdvertiserRegisterDto) => Promise<AdvertiserProfile>;
  logout: () => Promise<void>;
  updateProfile: (patch: Partial<AdvertiserProfile>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(authStore.subscribe, authStore.getState, authStore.getState);
  const queryClient = useQueryClient();

  useEffect(() => {
    return authStore.onSessionExpired((reason) => {
      queryClient.clear();
      const { title, description } = describeApiError({ code: reason });
      toast.error(title, { description: description ?? 'Please sign in again.' });
    });
  }, [queryClient]);

  const login = useCallback(
    async (dto: EmailPasswordLoginDto, remember: boolean) => {
      const response = await authApi.login(dto);
      queryClient.clear();
      authStore.signIn(response.tokens, response.advertiser, remember);
      return response.advertiser;
    },
    [queryClient],
  );

  const register = useCallback(
    async (dto: AdvertiserRegisterDto) => {
      const response = await authApi.register(dto);
      queryClient.clear();
      authStore.signIn(response.tokens, response.advertiser, true);
      return response.advertiser;
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    const accessToken = authStore.getTokens()?.accessToken;
    authStore.clear();
    queryClient.clear();
    if (accessToken) {
      try {
        // cookie mode: the httpOnly refresh cookie is revoked + cleared server-side (security audit #16)
        await authApi.logout(accessToken);
      } catch {
        // Best effort: the local session is already gone.
      }
    }
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      profile: state.session?.profile ?? null,
      isAuthenticated: state.status === 'authenticated',
      isVerified: state.session?.profile.verificationStatus === 'verified',
      login,
      register,
      logout,
      updateProfile: (patch) => authStore.updateProfile(patch),
    }),
    [state, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
