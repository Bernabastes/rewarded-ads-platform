import type { AdvertiserProfile, LegalDocumentItem } from '@rap/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { advertisersApi, legalApi, type AdvertiserConsentState } from '@/lib/api';
import { authStore } from '@/lib/api/auth-store';
import { queryKeys } from '@/lib/query/keys';

export const TERMS_LOCALE = 'en';

/** Current advertiser terms document (public endpoint; cached for the session). */
export function useCurrentTerms(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.legal.current('advertiser', TERMS_LOCALE),
    queryFn: () => legalApi.current({ audience: 'advertiser', locale: TERMS_LOCALE }),
    select: (data): LegalDocumentItem | null => data.documents.find((d) => d.kind === 'terms') ?? null,
    staleTime: 5 * 60_000,
    enabled: options.enabled ?? true,
  });
}

/** Advertiser consent state (accepted vs current versions, with acceptance timestamps). */
export function useAdvertiserConsents(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.advertiser.consents,
    queryFn: advertisersApi.consentState,
    enabled: options.enabled ?? true,
  });
}

/** Fields of the cached profile that mirror the consent state. */
export function consentPatch(state: AdvertiserConsentState): Partial<AdvertiserProfile> {
  return {
    acceptedTermsVersion: state.acceptedTermsVersion,
    currentTermsVersion: state.currentTermsVersion,
    requiresTermsAcceptance: state.requiresTermsAcceptance,
  };
}

/**
 * Accept the current advertiser terms. On success the cached profile is patched so every
 * `requiresTermsAcceptance` gate closes immediately, and the consent / profile queries refresh.
 */
export function useAcceptTerms() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (version: string) => advertisersApi.acceptConsent({ kind: 'terms', version }),
    onSuccess: async (state) => {
      authStore.updateProfile(consentPatch(state));
      queryClient.setQueryData(queryKeys.advertiser.consents, state);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.advertiser.me }),
        queryClient.invalidateQueries({ queryKey: queryKeys.legal.all }),
      ]);
    },
  });
}
