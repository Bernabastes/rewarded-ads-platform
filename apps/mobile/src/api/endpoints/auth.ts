import type {
  AuthTokens,
  CompleteProfileDto,
  OtpRequestDto,
  OtpRequestResponse,
  OtpVerifyDto,
  OtpVerifyResponse,
  UserProfile,
} from '@rap/shared';
import { API_ROUTES } from '@rap/shared';

import { api } from '@/api';
import { tokenStore } from '@/auth/tokenStore';

export const authApi = {
  requestOtp(dto: OtpRequestDto) {
    return api.post<OtpRequestResponse>(API_ROUTES.auth.otpRequest, dto, { auth: false });
  },
  async verifyOtp(dto: OtpVerifyDto): Promise<OtpVerifyResponse> {
    const result = await api.post<OtpVerifyResponse>(API_ROUTES.auth.otpVerify, dto, { auth: false });
    await tokenStore.set(result.tokens);
    return result;
  },
  completeProfile(dto: CompleteProfileDto) {
    return api.post<UserProfile>(API_ROUTES.auth.completeProfile, dto);
  },
  refresh(refreshToken: string) {
    return api.post<AuthTokens>(API_ROUTES.auth.refresh, { refreshToken }, { auth: false });
  },
  logout() {
    return api.logout();
  },
};
