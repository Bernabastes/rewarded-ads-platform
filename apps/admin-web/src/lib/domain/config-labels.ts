import type { PlatformConfigResponse } from '@rap/shared';

/** Human labels for `GET /admin/config` → `mocks.*` flags (unknown keys fall back to the raw key). */
export const MOCK_LABELS: Record<string, string> = {
  sms: 'SMS / OTP',
  payouts: 'Payouts (telebirr, Chapa)',
  paymentGateway: 'Payment gateway (Chapa)',
  push: 'Push (FCM)',
  idVerification: 'Id verification (Fayda)',
  alerts: 'Alert delivery (log notifier)',
  destinationLookup: 'Payout destination lookup',
} satisfies Partial<Record<keyof PlatformConfigResponse['mocks'], string>> & Record<string, string>;

export function mockLabel(key: string): string {
  return MOCK_LABELS[key] ?? key;
}
