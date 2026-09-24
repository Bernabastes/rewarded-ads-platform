import type { CampaignStatus } from '@rap/shared';

export const queryKeys = {
  overview: ['overview'] as const,
  campaigns: {
    all: ['campaigns'] as const,
    list: (params: { status?: CampaignStatus; page?: number; limit?: number }) =>
      ['campaigns', 'list', params] as const,
    detail: (id: string) => ['campaigns', 'detail', id] as const,
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
