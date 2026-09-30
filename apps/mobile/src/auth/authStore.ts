import type { LegalDocumentKind, UserProfile } from '@rap/shared';
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
  /**
   * Bumped every time the server answers 403 CONSENT_REQUIRED while the user is inside the app, so the
   * consent gate can navigate to the consent screen (and back) without unmounting the current stack.
   */
  consentPrompt: number;
  setHydrated(user: UserProfile | null): void;
  signIn(user: UserProfile): void;
  setUser(user: UserProfile): void;
  setBlocked(reason: BlockedReason | null): void;
  /** Marks the given legal document kinds as not accepted (from a 403 CONSENT_REQUIRED). */
  requireConsent(kinds: string[]): void;
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
  consentPrompt: 0,
  setHydrated: (user) =>
    set({ status: user ? 'signedIn' : 'signedOut', user, blocked: blockedReasonFromUser(user) }),
  signIn: (user) => set({ status: 'signedIn', user, blocked: blockedReasonFromUser(user), signOutReason: null }),
  setUser: (user) => set((s) => ({ user, blocked: blockedReasonFromUser(user) ?? s.blocked })),
  setBlocked: (blocked) => set({ blocked }),
  requireConsent: (kinds) =>
    set((s) => {
      if (!s.user) return s;
      const required = (kinds.length ? kinds : ['terms', 'privacy']) as LegalDocumentKind[];
      const consents = s.user.consents?.map((c) =>
        required.includes(c.kind) ? { ...c, outdated: true } : c,
      );
      return { user: { ...s.user, requiresConsent: required, consents: consents ?? [] }, consentPrompt: s.consentPrompt + 1 };
    }),
  signOut: (reason = null) => set({ status: 'signedOut', user: null, blocked: null, signOutReason: reason }),
}));

export const selectIsSignedIn = (s: AuthState) => s.status === 'signedIn';
export const selectProfileComplete = (s: AuthState) => s.user?.profileComplete === true;
/** True while the current terms / privacy versions are not accepted (money endpoints answer 403 CONSENT_REQUIRED). */
export const selectNeedsConsent = (s: AuthState) => (s.user?.requiresConsent?.length ?? 0) > 0;

export function userNeedsConsent(user: Pick<UserProfile, 'requiresConsent'> | null | undefined): boolean {
  return (user?.requiresConsent?.length ?? 0) > 0;
}
