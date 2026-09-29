import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useAuth } from '@/features/auth/auth-provider';
import { advertisersApi } from '@/lib/api';
import { authStore } from '@/lib/api/auth-store';
import { queryKeys } from '@/lib/query/keys';

/**
 * `GET /advertisers/me`: the source of truth for verification status, wallet balance, notification
 * preferences and terms acceptance. Whenever it resolves, the cached session profile is patched so every
 * consumer of `useAuth().profile` (banners, guards, gates) reflects the server without a re-login.
 */
export function useAdvertiserProfile(options: { enabled?: boolean; staleTime?: number } = {}) {
  const { isAuthenticated } = useAuth();
  const query = useQuery({
    queryKey: queryKeys.advertiser.me,
    queryFn: advertisersApi.me,
    enabled: (options.enabled ?? true) && isAuthenticated,
    staleTime: options.staleTime ?? 60_000,
  });

  const data = query.data;
  useEffect(() => {
    // The store function is module-stable, so this only runs when a fresh profile arrives.
    if (data) authStore.updateProfile(data);
  }, [data]);

  return query;
}

/** Mount once inside the authenticated shell to keep the cached profile in sync. */
export function ProfileSync() {
  useAdvertiserProfile();
  return null;
}
