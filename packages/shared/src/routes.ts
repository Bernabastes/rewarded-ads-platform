/**
 * API route constants. All paths are relative to the versioned base path.
 * Use these from the frontends instead of hard-coding strings.
 */
export const API_BASE_PATH = '/api/v1';
export const SWAGGER_UI_PATH = '/api/docs';
export const OPENAPI_JSON_PATH = '/api/docs-json';

export const API_ROUTES = {
  health: { live: '/health', ready: '/health/ready' },

  auth: {
    otpRequest: '/auth/otp/request',
    otpVerify: '/auth/otp/verify',
    completeProfile: '/auth/users/complete-profile',
    advertiserRegister: '/auth/advertiser/register',
    advertiserLogin: '/auth/advertiser/login',
    adminLogin: '/auth/admin/login',
    refresh: '/auth/refresh',
    logout: '/auth/logout',
  },

  users: {
    me: '/users/me',
    summary: '/users/me/summary',
    balance: '/users/me/balance',
    ledger: '/users/me/ledger',
    notifications: '/users/me/notifications',
    notificationRead: (id: string) => `/users/me/notifications/${id}/read`,
    pushTokens: '/users/me/push-tokens',
    pushToken: (token: string) => `/users/me/push-tokens/${encodeURIComponent(token)}`,
    adReports: '/users/me/ad-reports',
  },

  ads: {
    feed: '/ads/feed',
    detail: (adId: string) => `/ads/${adId}`,
    startWatchSession: (adId: string) => `/ads/${adId}/watch-sessions`,
    heartbeat: (sessionId: string) => `/ads/watch-sessions/${sessionId}/heartbeat`,
    complete: (sessionId: string) => `/ads/watch-sessions/${sessionId}/complete`,
  },

  offers: {
    list: '/offers',
    myCompletions: '/offers/me/completions',
    survey: (id: string) => `/offers/surveys/${id}`,
    surveyComplete: (id: string) => `/offers/surveys/${id}/complete`,
    appInstall: (id: string) => `/offers/app-installs/${id}`,
    appInstallComplete: (id: string) => `/offers/app-installs/${id}/complete`,
  },

  campaigns: {
    list: '/campaigns',
    create: '/campaigns',
    overview: '/campaigns/overview',
    presignUpload: '/campaigns/uploads/presign',
    detail: (id: string) => `/campaigns/${id}`,
    submit: (id: string) => `/campaigns/${id}/submit`,
    pause: (id: string) => `/campaigns/${id}/pause`,
    resume: (id: string) => `/campaigns/${id}/resume`,
    ads: (id: string) => `/campaigns/${id}/ads`,
    ad: (id: string, adId: string) => `/campaigns/${id}/ads/${adId}`,
    analytics: (id: string) => `/campaigns/${id}/analytics`,
  },

  billing: {
    balance: '/billing/balance',
    ledger: '/billing/ledger',
    topups: '/billing/topups',
    payments: '/billing/payments',
    payment: (id: string) => `/billing/payments/${id}`,
    invoices: '/billing/invoices',
    invoice: (id: string) => `/billing/invoices/${id}`,
    chapaWebhook: '/billing/webhooks/chapa',
    mockCheckout: (txRef: string) => `/billing/mock-checkout/${txRef}`,
    mockCheckoutPay: (txRef: string) => `/billing/mock-checkout/${txRef}/pay`,
  },

  withdrawals: {
    config: '/withdrawals/config',
    create: '/withdrawals',
    list: '/withdrawals',
    detail: (id: string) => `/withdrawals/${id}`,
  },

  admin: {
    me: '/admin/me',
    overview: '/admin/overview',
    config: '/admin/config',
    adsReviewQueue: '/admin/ads/review-queue',
    ad: (id: string) => `/admin/ads/${id}`,
    adApprove: (id: string) => `/admin/ads/${id}/approve`,
    adReject: (id: string) => `/admin/ads/${id}/reject`,
    users: '/admin/users',
    user: (id: string) => `/admin/users/${id}`,
    userSuspend: (id: string) => `/admin/users/${id}/suspend`,
    userBan: (id: string) => `/admin/users/${id}/ban`,
    userReinstate: (id: string) => `/admin/users/${id}/reinstate`,
    advertisers: '/admin/advertisers',
    advertiser: (id: string) => `/admin/advertisers/${id}`,
    advertiserVerify: (id: string) => `/admin/advertisers/${id}/verify`,
    advertiserReject: (id: string) => `/admin/advertisers/${id}/reject`,
    campaigns: '/admin/campaigns',
    campaign: (id: string) => `/admin/campaigns/${id}`,
    campaignApprove: (id: string) => `/admin/campaigns/${id}/approve`,
    campaignReject: (id: string) => `/admin/campaigns/${id}/reject`,
    campaignPause: (id: string) => `/admin/campaigns/${id}/pause`,
    campaignResume: (id: string) => `/admin/campaigns/${id}/resume`,
    fraudMetrics: '/admin/fraud/metrics',
    fraudFlags: '/admin/fraud/flags',
    fraudFlag: (id: string) => `/admin/fraud/flags/${id}`,
    fraudFlagDismiss: (id: string) => `/admin/fraud/flags/${id}/dismiss`,
    fraudFlagEscalate: (id: string) => `/admin/fraud/flags/${id}/escalate`,
    fraudFlagSuspendUser: (id: string) => `/admin/fraud/flags/${id}/suspend-user`,
    withdrawals: '/admin/withdrawals',
    withdrawal: (id: string) => `/admin/withdrawals/${id}`,
    withdrawalApprove: (id: string) => `/admin/withdrawals/${id}/approve`,
    withdrawalReject: (id: string) => `/admin/withdrawals/${id}/reject`,
    withdrawalRetry: (id: string) => `/admin/withdrawals/${id}/retry`,
    coinAdjustments: '/admin/coin-adjustments',
    coinAdjustment: (id: string) => `/admin/coin-adjustments/${id}`,
    coinAdjustmentApprove: (id: string) => `/admin/coin-adjustments/${id}/approve`,
    coinAdjustmentReject: (id: string) => `/admin/coin-adjustments/${id}/reject`,
    coinAdjustmentCancel: (id: string) => `/admin/coin-adjustments/${id}/cancel`,
    revenueOverview: '/admin/revenue/overview',
    auditLog: '/admin/audit-log',
    adReports: '/admin/ad-reports',
    adReportReview: (id: string) => `/admin/ad-reports/${id}/review`,
    appInstallCompletions: '/admin/offers/app-install-completions',
    appInstallCompletionVerify: (id: string) => `/admin/offers/app-install-completions/${id}/verify`,
    appInstallCompletionReject: (id: string) => `/admin/offers/app-install-completions/${id}/reject`,
  },

  fraud: {
    flags: '/fraud/flags',
    resolveFlag: (id: string) => `/fraud/flags/${id}/resolve`,
    recomputeTrust: (userId: string) => `/fraud/users/${userId}/recompute-trust`,
    rules: '/fraud/rules',
  },
} as const;
