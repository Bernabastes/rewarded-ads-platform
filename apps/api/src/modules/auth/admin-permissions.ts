import type { AdminRole } from '@prisma/client';

/** Coarse permission strings per admin role (mirrored by the admin dashboard UI). */
export const ADMIN_PERMISSIONS: Record<AdminRole, string[]> = {
  super_admin: [
    'ads.review',
    'campaigns.moderate',
    'users.moderate',
    'advertisers.verify',
    'fraud.manage',
    'withdrawals.decide',
    'adjustments.manage',
    'revenue.view',
    'audit.view',
    'reports.review',
    'offers.verify',
    'kyc.review',
    'alerts.view',
    'alerts.ack',
    'referrals.view',
    'deletions.manage',
    'users.impersonate',
  ],
  ad_reviewer: ['ads.review', 'campaigns.moderate', 'reports.review', 'alerts.view'],
  support: [
    'users.moderate',
    'advertisers.verify',
    'fraud.manage',
    'reports.review',
    'audit.view',
    'offers.verify',
    'kyc.review',
    'alerts.view',
    'alerts.ack',
    'referrals.view',
    'deletions.manage',
    'users.impersonate',
  ],
  finance: [
    'withdrawals.decide',
    'adjustments.manage',
    'revenue.view',
    'audit.view',
    'fraud.manage',
    'kyc.review',
    'alerts.view',
    'alerts.ack',
    'referrals.view',
  ],
};

export function permissionsFor(role: AdminRole): string[] {
  return ADMIN_PERMISSIONS[role] ?? [];
}
