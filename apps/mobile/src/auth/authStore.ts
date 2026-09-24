import type { UserProfile } from '@rap/shared';
import { ErrorCode, UserStatus } from '@rap/shared';
import { create } from 'zustand';

export type AuthStatus = 'hydrating' | 'signedOut' | 'signedIn';
export type BlockedReason = 'age_restricted' | 'suspended' | 'banned';

interface AuthState {
  status: AuthStatus;
  user: UserProfile | null;
  blocked: BlockedReason | null;
  /** Set when the user was signed out involuntarily (refresh failure) so the login screen can explain why. */
  signOutReason: string | null;
  setHydrated(user: UserProfile | null): void;
  signIn(user: UserProfile): void;
  setUser(user: UserProfile): void;
  setBlocked(reason: BlockedReason | null): void;
  signOut(reason?: string | null): void;
}

export function blockedReasonFromCode(code: string): BlockedReason | null {
  switch (code) {
    case ErrorCode.AGE_RESTRICTED:
      return 'age_restricted';
    case ErrorCode.ACCOUNT_SUSPENDED:
      return 'suspended';
    case ErrorCode.ACCOUNT_BANNED:
      return 'banned';
    default:
      return null;
  }
}

export function blockedReasonFromUser(user: UserProfile | null): BlockedReason | null {
  if (!user) return null;
  if (user.status === UserStatus.banned) return 'banned';
  if (user.status === UserStatus.suspended) return 'suspended';
  if (user.ageVerificationStatus === 'rejected') return 'age_restricted';
  return null;
}

export const useAuthStore = create<AuthState>()((set) => ({
  status: 'hydrating',
  user: null,
  blocked: null,
  signOutReason: null,
  setHydrated: (user) =>
    set({ status: user ? 'signedIn' : 'signedOut', user, blocked: blockedReasonFromUser(user) }),
  signIn: (user) => set({ status: 'signedIn', user, blocked: blockedReasonFromUser(user), signOutReason: null }),
  setUser: (user) => set((s) => ({ user, blocked: blockedReasonFromUser(user) ?? s.blocked })),
  setBlocked: (blocked) => set({ blocked }),
  signOut: (reason = null) => set({ status: 'signedOut', user: null, blocked: null, signOutReason: reason }),
}));

export const selectIsSignedIn = (s: AuthState) => s.status === 'signedIn';
export const selectProfileComplete = (s: AuthState) => s.user?.profileComplete === true;
