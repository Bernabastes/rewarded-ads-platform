import type { AdvertiserProfile, ChangePasswordDto, UpdateAdvertiserProfileDto } from '@rap/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { advertisersApi, authApi } from '@/lib/api';
import { authStore } from '@/lib/api/auth-store';
import { queryKeys } from '@/lib/query/keys';

/** `PATCH /advertisers/me` — the response is the fresh profile; cache + session store are updated. */
export function useUpdateAdvertiserProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateAdvertiserProfileDto) => advertisersApi.update(dto),
    onSuccess: (profile: AdvertiserProfile) => {
      queryClient.setQueryData(queryKeys.advertiser.me, profile);
      authStore.updateProfile(profile);
    },
  });
}

/** `POST /auth/advertiser/change-password` — revokes every refresh token; the caller signs the user out. */
export function useChangePassword() {
  return useMutation({ mutationFn: (dto: ChangePasswordDto) => authApi.changePassword(dto) });
}
