import { AdminRole } from '@rap/shared';

export type Role = AdminRole;

export const ALL_ROLES: readonly Role[] = [
  AdminRole.super_admin,
  AdminRole.ad_reviewer,
  AdminRole.support,
  AdminRole.finance,
];

/**
 * Mirror of the server-side @Roles() matrix in apps/api/src/modules/admin/controllers/admin.controllers.ts.
 * The server is authoritative; this only decides what to render / enable.
 */
export const ACCESS = {
  overview: ALL_ROLES,
  config: ALL_ROLES,

  reviewQueue: ['super_admin', 'ad_reviewer'],
  adDetail: ['super_admin', 'ad_reviewer', 'support'],
  adDecide: ['super_admin', 'ad_reviewer'],

  campaigns: ['super_admin', 'ad_reviewer', 'support', 'finance'],
  campaignDecide: ['super_admin', 'ad_reviewer'],
  campaignPauseResume: ['super_admin', 'ad_reviewer', 'support'],

  adReports: ['super_admin', 'ad_reviewer', 'support'],

  users: ['super_admin', 'support', 'finance'],
  usersModerate: ['super_admin', 'support'],

  advertisers: ['super_admin', 'support', 'finance', 'ad_reviewer'],
  advertisersDecide: ['super_admin', 'support'],

  fraud: ['super_admin', 'support', 'finance'],

  withdrawals: ['super_admin', 'finance'],
  adjustments: ['super_admin', 'finance'],
  revenue: ['super_admin', 'finance'],

  audit: ['super_admin', 'finance', 'support'],
  appInstalls: ['super_admin', 'support'],

  // Phase 4A/4C. GET /admin/alerts is readable by every admin role (reviewers see spend-velocity alerts on the
  // campaigns they review); acknowledging stays support/finance/super_admin, run-rules super_admin only.
  kyc: ['super_admin', 'support', 'finance'],
  alerts: ['super_admin', 'support', 'finance', 'ad_reviewer'],
  alertsAck: ['super_admin', 'support', 'finance'],
  alertsRunRules: ['super_admin'],
  referrals: ['super_admin', 'support', 'finance'],
  deletionRequests: ['super_admin', 'support'],
  impersonate: ['super_admin', 'support'],
  mediaReprocess: ['super_admin', 'ad_reviewer'],

  // Phase 5 (#5): every admin manages their own password / TOTP; only super_admins manage other admins.
  accountSecurity: ALL_ROLES,
  adminAccounts: ['super_admin'],
} as const satisfies Record<string, readonly Role[]>;

export type AccessKey = keyof typeof ACCESS;

export function can(role: Role | null | undefined, key: AccessKey): boolean {
  if (!role) return false;
  return (ACCESS[key] as readonly Role[]).includes(role);
}

export function rolesFor(key: AccessKey): readonly Role[] {
  return ACCESS[key];
}

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Super admin',
  ad_reviewer: 'Ad reviewer',
  support: 'Support',
  finance: 'Finance',
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  super_admin: 'Full access to every queue and setting.',
  ad_reviewer: 'Reviews creatives, moderates campaigns and ad reports.',
  support: 'Handles users, KYC, advertiser verification, fraud flags, alerts, deletion requests and reports.',
  finance: 'Decides withdrawals, coin adjustments and KYC; monitors revenue, referrals, alerts and fraud.',
};
