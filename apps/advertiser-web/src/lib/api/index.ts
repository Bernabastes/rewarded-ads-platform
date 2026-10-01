import {
  API_ROUTES,
  AUTH_MODE_COOKIE,
  AUTH_MODE_HEADER,
  IDEMPOTENCY_KEY_HEADER,
  type AcceptConsentDto,
  type AdvertiserAuthResponse,
  type AdvertiserLedgerEntry,
  type AdvertiserOverview,
  type AdvertiserProfile,
  type AdvertiserRegisterDto,
  type AdSummary,
  type CampaignAnalytics,
  type CampaignDetail,
  type CampaignStatus,
  type CampaignSummary,
  type ChangePasswordDto,
  type CreateAdDto,
  type CreateCampaignDto,
  type CreateTopupDto,
  type CurrentLegalDocumentsResponse,
  type EmailPasswordLoginDto,
  type InvoiceItem,
  type Language,
  type LegalDocumentKind,
  type Paginated,
  type PaymentItem,
  type PaymentStatus,
  type PresignUploadDto,
  type PresignUploadResponse,
  type TopupResponse,
  type UpdateAdvertiserProfileDto,
  type UpdateCampaignDto,
  type UserConsentState,
  type WalletBalanceResponse,
} from '@rap/shared';
import { env } from '@/config/env';
import { authStore } from './auth-store';
import { ApiClient, type SessionTokens } from './client';

export const apiClient = new ApiClient({
  baseUrl: env.apiBaseUrl,
  tokens: {
    get: () => authStore.getTokens(),
    set: (tokens: SessionTokens) => authStore.setTokens(tokens),
    expire: (reason) => authStore.expire(reason),
    getAccessTokenExpiry: () => authStore.getState().session?.accessTokenExpiresAt ?? null,
  },
});

/** Security audit #16: ask the API to keep the refresh token in an httpOnly cookie instead of the body. */
const COOKIE_MODE = { headers: { [AUTH_MODE_HEADER]: AUTH_MODE_COOKIE } };

export interface PageQuery {
  page?: number;
  limit?: number;
}

/** `POST /auth/advertiser/change-password` response (not yet typed in `@rap/shared`). */
export interface ChangePasswordResponse {
  changed: boolean;
  /** Every refresh token was revoked; the advertiser must sign in again. */
  sessionsRevoked: boolean;
}

/** `GET|POST /advertisers/me/consents` response: the generic per-kind state plus the advertiser terms shortcut fields. */
export interface AdvertiserConsentState {
  consents: UserConsentState[];
  requiresConsent: LegalDocumentKind[];
  acceptedTermsVersion: string | null;
  currentTermsVersion: string | null;
  requiresTermsAcceptance: boolean;
}

export const authApi = {
  login: (dto: EmailPasswordLoginDto) =>
    apiClient.post<AdvertiserAuthResponse>(API_ROUTES.auth.advertiserLogin, dto, { auth: false, ...COOKIE_MODE }),
  register: (dto: AdvertiserRegisterDto) =>
    apiClient.post<AdvertiserAuthResponse>(API_ROUTES.auth.advertiserRegister, dto, { auth: false, ...COOKIE_MODE }),
  /** The refresh cookie carries the token; the access token is sent so its jti is denylisted immediately. */
  logout: (accessToken?: string) =>
    apiClient.post<void>(API_ROUTES.auth.logout, {}, {
      auth: false,
      headers: { ...COOKIE_MODE.headers, ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    }),
  changePassword: (dto: ChangePasswordDto) =>
    apiClient.post<ChangePasswordResponse>(API_ROUTES.auth.advertiserChangePassword, dto),
};

export const legalApi = {
  /** Public: the current legal documents for an audience (advertisers only have `terms`). */
  current: (query: { audience: 'user' | 'advertiser'; locale?: Language } = { audience: 'advertiser' }) =>
    apiClient.get<CurrentLegalDocumentsResponse>(API_ROUTES.legal.current, { query, auth: false }),
};

export const advertisersApi = {
  me: () => apiClient.get<AdvertiserProfile>(API_ROUTES.advertisers.me),
  update: (dto: UpdateAdvertiserProfileDto) =>
    apiClient.patch<AdvertiserProfile>(API_ROUTES.advertisers.me, dto),
  consentState: () => apiClient.get<AdvertiserConsentState>(API_ROUTES.advertisers.consents),
  acceptConsent: (dto: AcceptConsentDto) =>
    apiClient.post<AdvertiserConsentState>(API_ROUTES.advertisers.consents, dto),
};

export const campaignsApi = {
  overview: () => apiClient.get<AdvertiserOverview>(API_ROUTES.campaigns.overview),
  list: (query: PageQuery & { status?: CampaignStatus } = {}) =>
    apiClient.get<Paginated<CampaignSummary>>(API_ROUTES.campaigns.list, { query }),
  detail: (id: string) => apiClient.get<CampaignDetail>(API_ROUTES.campaigns.detail(id)),
  create: (dto: CreateCampaignDto) => apiClient.post<CampaignSummary>(API_ROUTES.campaigns.create, dto),
  update: (id: string, dto: UpdateCampaignDto) =>
    apiClient.patch<CampaignSummary>(API_ROUTES.campaigns.detail(id), dto),
  remove: (id: string) => apiClient.delete(API_ROUTES.campaigns.detail(id)),
  submit: (id: string) => apiClient.post<CampaignSummary>(API_ROUTES.campaigns.submit(id)),
  pause: (id: string) => apiClient.post<CampaignSummary>(API_ROUTES.campaigns.pause(id)),
  resume: (id: string) => apiClient.post<CampaignSummary>(API_ROUTES.campaigns.resume(id)),
  presign: (dto: PresignUploadDto) =>
    apiClient.post<PresignUploadResponse>(API_ROUTES.campaigns.presignUpload, dto),
  ads: (id: string) => apiClient.get<AdSummary[]>(API_ROUTES.campaigns.ads(id)),
  addAd: (id: string, dto: CreateAdDto) => apiClient.post<AdSummary>(API_ROUTES.campaigns.ads(id), dto),
  removeAd: (id: string, adId: string) => apiClient.delete(API_ROUTES.campaigns.ad(id, adId)),
  analytics: (id: string, query: { from?: string; to?: string } = {}) =>
    apiClient.get<CampaignAnalytics>(API_ROUTES.campaigns.analytics(id), { query }),
};

export const billingApi = {
  balance: () => apiClient.get<WalletBalanceResponse>(API_ROUTES.billing.balance),
  ledger: (query: PageQuery = {}) =>
    apiClient.get<Paginated<AdvertiserLedgerEntry>>(API_ROUTES.billing.ledger, { query }),
  /**
   * Money POST: pass the per-intent `Idempotency-Key` so a retried request replays the stored response instead
   * of creating a second payment (see `createTopupIdempotent` for the 409 handling).
   */
  createTopup: (dto: CreateTopupDto, options: { idempotencyKey?: string } = {}) =>
    apiClient.post<TopupResponse>(API_ROUTES.billing.topups, dto, {
      headers: options.idempotencyKey ? { [IDEMPOTENCY_KEY_HEADER]: options.idempotencyKey } : undefined,
    }),
  payments: (query: PageQuery = {}) =>
    apiClient.get<Paginated<PaymentItem>>(API_ROUTES.billing.payments, { query }),
  payment: (id: string) => apiClient.get<PaymentItem>(API_ROUTES.billing.payment(id)),
  invoices: (query: PageQuery = {}) =>
    apiClient.get<Paginated<InvoiceItem>>(API_ROUTES.billing.invoices, { query }),
  invoice: (id: string) => apiClient.get<InvoiceItem>(API_ROUTES.billing.invoice(id)),
  /** Dev/demo only: settles a mock-gateway payment (public endpoint that exists only in mock mode). */
  mockCheckoutPay: (txRef: string, outcome: 'success' | 'failed') =>
    apiClient.post<{ status: PaymentStatus }>(
      API_ROUTES.billing.mockCheckoutPay(txRef),
      { outcome },
      { auth: false },
    ),
};
