/** Central TanStack Query key factory so invalidation stays consistent across features. */
export const queryKeys = {
  me: ['me'] as const,
  overview: ['overview'] as const,
  config: ['config'] as const,

  reviewQueue: (params: object) => ['review', 'queue', params] as const,
  ad: (id: string) => ['review', 'ad', id] as const,

  campaigns: (params: object) => ['campaigns', 'list', params] as const,
  campaign: (id: string) => ['campaigns', 'detail', id] as const,

  adReports: (params: object) => ['ad-reports', params] as const,

  users: (params: object) => ['users', 'list', params] as const,
  user: (id: string) => ['users', 'detail', id] as const,

  advertisers: (params: object) => ['advertisers', 'list', params] as const,
  advertiser: (id: string) => ['advertisers', 'detail', id] as const,

  fraudMetrics: ['fraud', 'metrics'] as const,
  fraudFlags: (params: object) => ['fraud', 'flags', params] as const,
  fraudFlag: (id: string) => ['fraud', 'flag', id] as const,

  withdrawals: (params: object) => ['withdrawals', 'list', params] as const,
  withdrawal: (id: string) => ['withdrawals', 'detail', id] as const,

  adjustments: (params: object) => ['adjustments', 'list', params] as const,
  adjustment: (id: string) => ['adjustments', 'detail', id] as const,

  revenue: (params: object) => ['revenue', params] as const,
  audit: (params: object) => ['audit', params] as const,
  appInstalls: (params: object) => ['app-installs', params] as const,
};
