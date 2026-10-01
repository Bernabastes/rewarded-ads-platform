import {
  API_ROUTES,
  AUTH_MODE_COOKIE,
  AUTH_MODE_HEADER,
  IDEMPOTENCY_KEY_HEADER,
  type AdFeedItem,
  type AdFeedMeta,
  type AdminAccountItem,
  type AdminAdReportItem,
  type AdminAdvertiserItem,
  type AdminAdvertisersQuery,
  type AdminAlertsQuery,
  type AdminAppInstallCompletionItem,
  type AdminAuthResponse,
  type AdminCampaignsQuery,
  type AdminChangePasswordResponse,
  type AdminCoinAdjustmentsQuery,
  type AdminDeletionRequestItem,
  type AdminDeletionRequestsQuery,
  type AdminKycDetail,
  type AdminKycQuery,
  type AdminKycSummary,
  type AdminLoginResponse,
  type AdminMe,
  type AdminOverview,
  type AdminReferralItem,
  type AdminReferralMetrics,
  type AdminReferralsQuery,
  type AdminUserListItem,
  type AdminUsersQuery,
  type AdminWithdrawalsQuery,
  type AdReviewQueueQuery,
  type AlertRulesRunResult,
  type ApproveAdDto,
  type AuditLogItem,
  type AuditLogMeta,
  type AuditLogQuery,
  type BalanceResponse,
  type BannedTopicsChecklist,
  type CoinAdjustmentItem,
  type CreateAdminDto,
  type CreateAdminResponse,
  type CreateCoinAdjustmentDto,
  type DeletionRequestItem,
  type FraudFlagItem,
  type FraudFlagsQuery,
  type FraudMetrics,
  type ImpersonationTokenResponse,
  type LedgerEntry,
  type MfaSetupResponse,
  type MfaStatusResponse,
  type NotificationItem,
  type OfferCompletionStatus,
  type Paginated,
  type PlatformAlertItem,
  type PlatformConfigResponse,
  type ResetAdminPasswordResponse,
  type RevenueOverview,
  type RevenueQuery,
  type ResolveManualReviewDto,
  type ReviewAdReportDto,
  type UpdateAdminRoleDto,
  type UserProfile,
  type WithdrawalItem,
} from '@rap/shared';
import { api } from './api';
import type { QueryParams } from './client';
import type { AdminAdvertiser, AdminCampaign, AdminCampaignDetail, AdminUser, AdminWithdrawal, AdReview, AlertsMeta } from './types';

const q = (params: object | undefined): QueryParams => (params ?? {}) as QueryParams;

/* ------------------------------- auth ------------------------------- */

/** Security audit #16: the console asks the API to keep the refresh token in an httpOnly cookie. */
const COOKIE_MODE = { headers: { [AUTH_MODE_HEADER]: AUTH_MODE_COOKIE } };

export const authApi = {
  login: (email: string, password: string) =>
    api.post<AdminLoginResponse>(API_ROUTES.auth.adminLogin, { email, password }, { anonymous: true, ...COOKIE_MODE }),
  /** Second login step for admins with TOTP enabled (Phase 5 #5). */
  loginMfa: (mfaToken: string, code: string) =>
    api.post<AdminAuthResponse>(API_ROUTES.auth.adminLoginMfa, { mfaToken, code }, { anonymous: true, ...COOKIE_MODE }),
  /** The refresh cookie carries the token; the current access token is sent so its jti is denylisted at once. */
  logout: (accessToken?: string) =>
    api.post<void>(API_ROUTES.auth.logout, {}, {
      anonymous: true,
      headers: { ...COOKIE_MODE.headers, ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
    }),
  me: () => api.get<AdminMe>(API_ROUTES.admin.me),
};

/* ------------------------ my account security (Phase 5 #5) ------------------------ */

export const accountApi = {
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<AdminChangePasswordResponse>(API_ROUTES.admin.meChangePassword, { currentPassword, newPassword }),
  // Phase 5b New-7: enrolment re-authenticates with the current password (setup AND enable).
  mfaSetup: (password: string) => api.post<MfaSetupResponse>(API_ROUTES.admin.meMfaSetup, { password }),
  mfaEnable: (code: string, password: string) => api.post<MfaStatusResponse>(API_ROUTES.admin.meMfaEnable, { code, password }),
  mfaDisable: (code: string, password: string) => api.post<MfaStatusResponse>(API_ROUTES.admin.meMfaDisable, { code, password }),
};

/* ------------------------ admin accounts (super_admin, Phase 5 #5) ------------------------ */

export const adminsApi = {
  list: () => api.get<{ data: AdminAccountItem[]; meta: { total: number } }>(API_ROUTES.admin.admins),
  create: (dto: CreateAdminDto) => api.post<CreateAdminResponse>(API_ROUTES.admin.admins, dto),
  changeRole: (id: string, dto: UpdateAdminRoleDto) => api.patch<AdminAccountItem>(API_ROUTES.admin.adminRole(id), dto),
  resetPassword: (id: string) => api.post<ResetAdminPasswordResponse>(API_ROUTES.admin.adminResetPassword(id), {}),
  setActive: (id: string, active: boolean, reason: string) => api.patch<AdminAccountItem>(`${API_ROUTES.admin.admins}/${id}/active`, { active, reason }),
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
  /** Re-run probe / transcode / poster for a creative whose media pipeline failed or looks wrong. */
  reprocessMedia: (id: string) => api.post<AdReview>(API_ROUTES.admin.adReprocessMedia(id), {}),
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
  /** 10-minute READ-ONLY user token; the reason / ticket reference lands in the audit log. */
  impersonate: (id: string, reason: string) => api.post<ImpersonationTokenResponse>(API_ROUTES.admin.userImpersonate(id), { reason }),
};

/* ------------------------- impersonation (view as user) ------------------- */

/**
 * User-scoped GET endpoints called with an impersonation token. The token is passed explicitly (never stored in
 * the admin token store) and requests are `anonymous` so the client never tries to refresh it - it simply expires.
 */
const asUser = <T>(path: string, token: string, query?: QueryParams) =>
  api.get<T>(path, { anonymous: true, headers: { authorization: `Bearer ${token}` }, query });

export const viewAsUserApi = {
  profile: (token: string) => asUser<UserProfile>(API_ROUTES.users.me, token),
  balance: (token: string) => asUser<BalanceResponse>(API_ROUTES.users.balance, token),
  ledger: (token: string, params?: { page?: number; limit?: number }) => asUser<Paginated<LedgerEntry>>(API_ROUTES.users.ledger, token, q(params)),
  feed: (token: string, params?: { page?: number; limit?: number }) => asUser<Paginated<AdFeedItem, AdFeedMeta>>(API_ROUTES.ads.feed, token, q(params)),
  withdrawals: (token: string, params?: { page?: number; limit?: number }) => asUser<Paginated<WithdrawalItem>>(API_ROUTES.withdrawals.list, token, q(params)),
  notifications: (token: string, params?: { page?: number; limit?: number }) =>
    asUser<Paginated<NotificationItem>>(API_ROUTES.users.notifications, token, q(params)),
};

/* -------------------------------- KYC -------------------------------- */

export const kycApi = {
  list: (params?: AdminKycQuery) => api.get<Paginated<AdminKycSummary>>(API_ROUTES.admin.kycQueue, { query: q(params) }),
  /** Document links are presigned for 5 minutes - always fetch fresh when the drawer opens. */
  detail: (id: string) => api.get<AdminKycDetail>(API_ROUTES.admin.kyc(id)),
  approve: (id: string, note?: string) => api.post<AdminKycSummary>(API_ROUTES.admin.kycApprove(id), { note: note || undefined }),
  reject: (id: string, reason: string, note?: string) => api.post<AdminKycSummary>(API_ROUTES.admin.kycReject(id), { reason, note: note || undefined }),
};

/* ------------------------------- alerts ------------------------------ */

export const alertsApi = {
  list: (params?: AdminAlertsQuery) => api.get<Paginated<PlatformAlertItem, AlertsMeta>>(API_ROUTES.admin.alerts, { query: q(params) }),
  ack: (id: string) => api.post<PlatformAlertItem>(API_ROUTES.admin.alertAck(id), {}),
  runRules: () => api.post<AlertRulesRunResult>(API_ROUTES.admin.alertsRunRules, {}),
};

/* ------------------------------ referrals ---------------------------- */

export const referralsApi = {
  list: (params?: AdminReferralsQuery) => api.get<Paginated<AdminReferralItem>>(API_ROUTES.admin.referrals, { query: q(params) }),
  metrics: () => api.get<AdminReferralMetrics>(API_ROUTES.admin.referralMetrics),
};

/* --------------------------- deletion requests ----------------------- */

export const deletionRequestsApi = {
  list: (params?: AdminDeletionRequestsQuery) =>
    api.get<Paginated<AdminDeletionRequestItem>>(API_ROUTES.admin.deletionRequests, { query: q(params) }),
  // The API returns the bare request (DeletionRequestItem, no `user`) from these two, unlike the list rows.
  execute: (id: string, note?: string) => api.post<DeletionRequestItem>(API_ROUTES.admin.deletionRequestExecute(id), { note: note || undefined }),
  cancel: (id: string, note?: string) => api.post<DeletionRequestItem>(API_ROUTES.admin.deletionRequestCancel(id), { note: note || undefined }),
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
  /** Finance decision for a payout whose partner outcome is unknown (status needs_manual_review). */
  resolveManualReview: (id: string, body: ResolveManualReviewDto) => api.post<AdminWithdrawal>(API_ROUTES.admin.withdrawalResolveManualReview(id), body),
};

/* --------------------------- coin adjustments ----------------------- */

export const adjustmentsApi = {
  list: (params?: AdminCoinAdjustmentsQuery) =>
    api.get<Paginated<CoinAdjustmentItem>>(API_ROUTES.admin.coinAdjustments, { query: q(params) }),
  detail: (id: string) => api.get<CoinAdjustmentItem>(API_ROUTES.admin.coinAdjustment(id)),
  /** `idempotencyKey` = one UUID per user intent (per "Submit"), reused on retries of the same payload. */
  create: (dto: CreateCoinAdjustmentDto, idempotencyKey?: string) =>
    api.post<CoinAdjustmentItem>(API_ROUTES.admin.coinAdjustments, dto, idempotencyKey ? { headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey } } : undefined),
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
  list: (params?: AuditLogQuery) => api.get<Paginated<AuditLogItem, AuditLogMeta>>(API_ROUTES.admin.auditLog, { query: q(params) }),
};

/* ----------------------------- app installs ------------------------- */

export const appInstallsApi = {
  list: (params?: { status?: OfferCompletionStatus; page?: number; limit?: number }) =>
    api.get<Paginated<AdminAppInstallCompletionItem>>(API_ROUTES.admin.appInstallCompletions, { query: q(params) }),
  verify: (id: string, note?: string) => api.post<unknown>(API_ROUTES.admin.appInstallCompletionVerify(id), { note }),
  reject: (id: string, reason: string) => api.post<unknown>(API_ROUTES.admin.appInstallCompletionReject(id), { reason }),
};
