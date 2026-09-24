import {
  API_ROUTES,
  type AdminAdReportItem,
  type AdminAdvertiserItem,
  type AdminAdvertisersQuery,
  type AdminAppInstallCompletionItem,
  type AdminAuthResponse,
  type AdminCampaignsQuery,
  type AdminCoinAdjustmentsQuery,
  type AdminMe,
  type AdminOverview,
  type AdminUserListItem,
  type AdminUsersQuery,
  type AdminWithdrawalsQuery,
  type AdReviewQueueQuery,
  type ApproveAdDto,
  type AuditLogItem,
  type AuditLogQuery,
  type BannedTopicsChecklist,
  type CoinAdjustmentItem,
  type CreateCoinAdjustmentDto,
  type FraudFlagItem,
  type FraudFlagsQuery,
  type FraudMetrics,
  type OfferCompletionStatus,
  type Paginated,
  type PlatformConfigResponse,
  type RevenueOverview,
  type RevenueQuery,
  type ReviewAdReportDto,
  type UserProfile,
} from '@rap/shared';
import { api } from './api';
import type { QueryParams } from './client';
import type { AdminAdvertiser, AdminCampaign, AdminCampaignDetail, AdminUser, AdminWithdrawal, AdReview } from './types';

const q = (params: object | undefined): QueryParams => (params ?? {}) as QueryParams;

/* ------------------------------- auth ------------------------------- */

export const authApi = {
  login: (email: string, password: string) =>
    api.post<AdminAuthResponse>(API_ROUTES.auth.adminLogin, { email, password }, { anonymous: true }),
  logout: (refreshToken: string) => api.post<void>(API_ROUTES.auth.logout, { refreshToken }, { anonymous: true }),
  me: () => api.get<AdminMe>(API_ROUTES.admin.me),
};

/* ------------------------------- home ------------------------------- */

export const homeApi = {
  overview: () => api.get<AdminOverview>(API_ROUTES.admin.overview),
  config: () => api.get<PlatformConfigResponse>(API_ROUTES.admin.config),
};

/* ---------------------------- ad review ----------------------------- */

export const reviewApi = {
  queue: (params?: AdReviewQueueQuery) => api.get<Paginated<AdReview>>(API_ROUTES.admin.adsReviewQueue, { query: q(params) }),
  ad: (id: string) => api.get<AdReview>(API_ROUTES.admin.ad(id)),
  approve: (id: string, dto: ApproveAdDto) => api.post<AdReview>(API_ROUTES.admin.adApprove(id), dto),
  reject: (id: string, reason: string, checklist?: BannedTopicsChecklist) =>
    api.post<AdReview>(API_ROUTES.admin.adReject(id), { reason, bannedTopicsChecklist: checklist }),
};

/* ----------------------------- campaigns ---------------------------- */

export const campaignsApi = {
  list: (params?: AdminCampaignsQuery) => api.get<Paginated<AdminCampaign>>(API_ROUTES.admin.campaigns, { query: q(params) }),
  detail: (id: string) => api.get<AdminCampaignDetail>(API_ROUTES.admin.campaign(id)),
  approve: (id: string, note?: string) => api.post<AdminCampaignDetail>(API_ROUTES.admin.campaignApprove(id), { note }),
  reject: (id: string, reason: string) => api.post<AdminCampaignDetail>(API_ROUTES.admin.campaignReject(id), { reason }),
  pause: (id: string, reason: string) => api.post<AdminCampaignDetail>(API_ROUTES.admin.campaignPause(id), { reason }),
  resume: (id: string) => api.post<AdminCampaignDetail>(API_ROUTES.admin.campaignResume(id), {}),
};

/* ----------------------------- ad reports --------------------------- */

export const adReportsApi = {
  list: (params?: { status?: string; page?: number; limit?: number }) =>
    api.get<Paginated<AdminAdReportItem>>(API_ROUTES.admin.adReports, { query: q(params) }),
  review: (id: string, dto: ReviewAdReportDto) => api.post<AdminAdReportItem>(API_ROUTES.admin.adReportReview(id), dto),
};

/* ------------------------------- users ------------------------------ */

export const usersApi = {
  list: (params?: AdminUsersQuery) => api.get<Paginated<AdminUserListItem>>(API_ROUTES.admin.users, { query: q(params) }),
  detail: (id: string) => api.get<AdminUser>(API_ROUTES.admin.user(id)),
  suspend: (id: string, reason: string) => api.post<UserProfile>(API_ROUTES.admin.userSuspend(id), { reason }),
  ban: (id: string, reason: string) => api.post<UserProfile>(API_ROUTES.admin.userBan(id), { reason }),
  reinstate: (id: string, reason: string) => api.post<UserProfile>(API_ROUTES.admin.userReinstate(id), { reason }),
};

/* ---------------------------- advertisers --------------------------- */

export const advertisersApi = {
  list: (params?: AdminAdvertisersQuery) =>
    api.get<Paginated<AdminAdvertiserItem>>(API_ROUTES.admin.advertisers, { query: q(params) }),
  detail: (id: string) => api.get<AdminAdvertiser>(API_ROUTES.admin.advertiser(id)),
  verify: (id: string, note?: string) => api.post<AdminAdvertiser>(API_ROUTES.admin.advertiserVerify(id), { note }),
  reject: (id: string, reason: string) => api.post<AdminAdvertiser>(API_ROUTES.admin.advertiserReject(id), { reason }),
};

/* -------------------------------- fraud ----------------------------- */

export const fraudApi = {
  metrics: () => api.get<FraudMetrics>(API_ROUTES.admin.fraudMetrics),
  flags: (params?: FraudFlagsQuery) => {
    // API quirk: `resolved=false` is coerced to true by the server (Boolean("false")). An empty value
    // coerces to false, so we send `resolved=` for the "open" filter. See README "API gaps".
    const { resolved, ...rest } = params ?? {};
    const query: QueryParams = { ...(rest as QueryParams) };
    if (resolved === true) query.resolved = 'true';
    else if (resolved === false) query.resolved = '';
    return api.get<Paginated<FraudFlagItem>>(API_ROUTES.admin.fraudFlags, { query });
  },
  flag: (id: string) => api.get<FraudFlagItem>(API_ROUTES.admin.fraudFlag(id)),
  dismiss: (id: string, note?: string) => api.post<FraudFlagItem>(API_ROUTES.admin.fraudFlagDismiss(id), { note }),
  escalate: (id: string, note?: string) => api.post<FraudFlagItem>(API_ROUTES.admin.fraudFlagEscalate(id), { note }),
  suspendUser: (id: string, reason: string) => api.post<FraudFlagItem>(API_ROUTES.admin.fraudFlagSuspendUser(id), { reason }),
};

/* ----------------------------- withdrawals -------------------------- */

export const withdrawalsApi = {
  list: (params?: AdminWithdrawalsQuery) =>
    api.get<Paginated<AdminWithdrawal>>(API_ROUTES.admin.withdrawals, { query: q(params) }),
  detail: (id: string) => api.get<AdminWithdrawal>(API_ROUTES.admin.withdrawal(id)),
  approve: (id: string, note?: string) => api.post<AdminWithdrawal>(API_ROUTES.admin.withdrawalApprove(id), { note }),
  reject: (id: string, reason: string) => api.post<AdminWithdrawal>(API_ROUTES.admin.withdrawalReject(id), { reason }),
  retry: (id: string) => api.post<AdminWithdrawal>(API_ROUTES.admin.withdrawalRetry(id), {}),
};

/* --------------------------- coin adjustments ----------------------- */

export const adjustmentsApi = {
  list: (params?: AdminCoinAdjustmentsQuery) =>
    api.get<Paginated<CoinAdjustmentItem>>(API_ROUTES.admin.coinAdjustments, { query: q(params) }),
  detail: (id: string) => api.get<CoinAdjustmentItem>(API_ROUTES.admin.coinAdjustment(id)),
  create: (dto: CreateCoinAdjustmentDto) => api.post<CoinAdjustmentItem>(API_ROUTES.admin.coinAdjustments, dto),
  approve: (id: string, note?: string) => api.post<CoinAdjustmentItem>(API_ROUTES.admin.coinAdjustmentApprove(id), { note }),
  reject: (id: string, reason: string) => api.post<CoinAdjustmentItem>(API_ROUTES.admin.coinAdjustmentReject(id), { reason }),
  cancel: (id: string) => api.post<CoinAdjustmentItem>(API_ROUTES.admin.coinAdjustmentCancel(id), {}),
};

/* -------------------------------- revenue --------------------------- */

export const revenueApi = {
  overview: (params?: RevenueQuery) => api.get<RevenueOverview>(API_ROUTES.admin.revenueOverview, { query: q(params) }),
};

/* ------------------------------- audit log -------------------------- */

export const auditApi = {
  list: (params?: AuditLogQuery) => api.get<Paginated<AuditLogItem>>(API_ROUTES.admin.auditLog, { query: q(params) }),
};

/* ----------------------------- app installs ------------------------- */

export const appInstallsApi = {
  list: (params?: { status?: OfferCompletionStatus; page?: number; limit?: number }) =>
    api.get<Paginated<AdminAppInstallCompletionItem>>(API_ROUTES.admin.appInstallCompletions, { query: q(params) }),
  verify: (id: string, note?: string) => api.post<unknown>(API_ROUTES.admin.appInstallCompletionVerify(id), { note }),
  reject: (id: string, reason: string) => api.post<unknown>(API_ROUTES.admin.appInstallCompletionReject(id), { reason }),
};
