import type {
  CreateWithdrawalDto,
  Paginated,
  PaginationQuery,
  PayoutDestinationItem,
  ResolveDestinationDto,
  ResolveDestinationResponse,
  VerifyDestinationOtpDto,
  WithdrawalConfig,
  WithdrawalItem,
  WithdrawalStatus,
} from '@rap/shared';
import { API_ROUTES, IDEMPOTENCY_KEY_HEADER } from '@rap/shared';

import { api } from '@/api';

/** `POST /withdrawals/destinations/otp/request` (OTP goes to the user's own phone, masked in the response). */
export interface DestinationOtpRequestResponse {
  phoneNumber: string;
  purpose?: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
  /** Present ONLY when the API runs with OTP_DEV_ECHO=true (dev/demo). */
  devCode?: string;
}

export const withdrawalsApi = {
  config() {
    return api.get<WithdrawalConfig>(API_ROUTES.withdrawals.config);
  },
  /**
   * Money POST: pass the per-intent `Idempotency-Key` so a network retry can never create two requests
   * (same key + same payload replays the stored response; see `submitWithdrawal`).
   */
  create(dto: CreateWithdrawalDto, idempotencyKey?: string) {
    return api.post<WithdrawalItem>(API_ROUTES.withdrawals.create, dto, {
      headers: idempotencyKey ? { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey } : undefined,
    });
  },
  list(query: PaginationQuery & { status?: WithdrawalStatus } = {}) {
    return api.get<Paginated<WithdrawalItem>>(API_ROUTES.withdrawals.list, { query });
  },
  detail(id: string) {
    return api.get<WithdrawalItem>(API_ROUTES.withdrawals.detail(id));
  },

  /* ---------- destination verification (Phase 4A) ---------- */
  destinations() {
    return api.get<PayoutDestinationItem[]>(API_ROUTES.withdrawals.destinations);
  },
  resolveDestination(dto: ResolveDestinationDto) {
    return api.post<ResolveDestinationResponse>(API_ROUTES.withdrawals.resolveDestination, dto);
  },
  requestDestinationOtp() {
    return api.post<DestinationOtpRequestResponse>(API_ROUTES.withdrawals.destinationOtpRequest);
  },
  verifyDestinationOtp(dto: VerifyDestinationOtpDto) {
    return api.post<PayoutDestinationItem>(API_ROUTES.withdrawals.destinationOtpVerify, dto);
  },
};
