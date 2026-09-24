import {
  API_ROUTES,
  type AdvertiserAuthResponse,
  type AdvertiserLedgerEntry,
  type AdvertiserOverview,
  type AdvertiserRegisterDto,
  type AdSummary,
  type AuthTokens,
  type CampaignAnalytics,
  type CampaignDetail,
  type CampaignStatus,
  type CampaignSummary,
  type CreateAdDto,
  type CreateCampaignDto,
  type CreateTopupDto,
  type EmailPasswordLoginDto,
  type InvoiceItem,
  type Paginated,
  type PaymentItem,
  type PresignUploadDto,
  type PresignUploadResponse,
  type TopupResponse,
  type UpdateCampaignDto,
  type WalletBalanceResponse,
} from '@rap/shared';
import { env } from '@/config/env';
import { authStore } from './auth-store';
import { ApiClient } from './client';

export const apiClient = new ApiClient({
  baseUrl: env.apiBaseUrl,
  tokens: {
    get: () => authStore.getTokens(),
    set: (tokens: AuthTokens) => authStore.setTokens(tokens),
    expire: (reason) => authStore.expire(reason),
    getAccessTokenExpiry: () => authStore.getState().session?.accessTokenExpiresAt ?? null,
  },
});

export interface PageQuery {
  page?: number;
  limit?: number;
}

export const authApi = {
  login: (dto: EmailPasswordLoginDto) =>
    apiClient.post<AdvertiserAuthResponse>(API_ROUTES.auth.advertiserLogin, dto, { auth: false }),
  register: (dto: AdvertiserRegisterDto) =>
    apiClient.post<AdvertiserAuthResponse>(API_ROUTES.auth.advertiserRegister, dto, { auth: false }),
  logout: (refreshToken: string) =>
    apiClient.post<void>(API_ROUTES.auth.logout, { refreshToken }, { auth: false }),
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
  createTopup: (dto: CreateTopupDto) => apiClient.post<TopupResponse>(API_ROUTES.billing.topups, dto),
  payments: (query: PageQuery = {}) =>
    apiClient.get<Paginated<PaymentItem>>(API_ROUTES.billing.payments, { query }),
  payment: (id: string) => apiClient.get<PaymentItem>(API_ROUTES.billing.payment(id)),
  invoices: (query: PageQuery = {}) =>
    apiClient.get<Paginated<InvoiceItem>>(API_ROUTES.billing.invoices, { query }),
  invoice: (id: string) => apiClient.get<InvoiceItem>(API_ROUTES.billing.invoice(id)),
};
