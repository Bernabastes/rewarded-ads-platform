import type { CampaignStatus } from '@rap/shared';

export const queryKeys = {
  overview: ['overview'] as const,
  legal: {
    all: ['legal'] as const,
    current: (audience: 'user' | 'advertiser', locale: string) => ['legal', 'current', audience, locale] as const,
  },
  advertiser: {
    all: ['advertiser'] as const,
    me: ['advertiser', 'me'] as const,
    consents: ['advertiser', 'consents'] as const,
  },
  campaigns: {
    all: ['campaigns'] as const,
    list: (params: { status?: CampaignStatus; page?: number; limit?: number }) =>
      ['campaigns', 'list', params] as const,
    detail: (id: string) => ['campaigns', 'detail', id] as const,
    /** Creative list polled while the media pipeline is processing. */
    ads: (id: string) => ['campaigns', 'ads', id] as const,
    analytics: (id: string, range: { from?: string; to?: string }) =>
      ['campaigns', 'analytics', id, range] as const,
  },
  billing: {
    all: ['billing'] as const,
    balance: ['billing', 'balance'] as const,
    payments: (params: { page?: number; limit?: number }) => ['billing', 'payments', params] as const,
    payment: (id: string) => ['billing', 'payment', id] as const,
    invoices: (params: { page?: number; limit?: number }) => ['billing', 'invoices', params] as const,
    invoice: (id: string) => ['billing', 'invoice', id] as const,
    ledger: (params: { page?: number; limit?: number }) => ['billing', 'ledger', params] as const,
  },
};
