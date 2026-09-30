import { describe, expect, it } from 'vitest';
import { ACCESS, ALL_ROLES, can, rolesFor } from './rbac';

describe('RBAC matrix (mirror of the API @Roles decorators)', () => {
  it('super_admin can do everything', () => {
    for (const key of Object.keys(ACCESS) as Array<keyof typeof ACCESS>) expect(can('super_admin', key)).toBe(true);
  });

  it('ad_reviewer: review queue + campaigns + ad reports, nothing financial', () => {
    expect(can('ad_reviewer', 'reviewQueue')).toBe(true);
    expect(can('ad_reviewer', 'adDecide')).toBe(true);
    expect(can('ad_reviewer', 'campaignDecide')).toBe(true);
    expect(can('ad_reviewer', 'adReports')).toBe(true);
    expect(can('ad_reviewer', 'advertisers')).toBe(true);
    expect(can('ad_reviewer', 'advertisersDecide')).toBe(false);
    expect(can('ad_reviewer', 'users')).toBe(false);
    expect(can('ad_reviewer', 'withdrawals')).toBe(false);
    expect(can('ad_reviewer', 'adjustments')).toBe(false);
    expect(can('ad_reviewer', 'revenue')).toBe(false);
    expect(can('ad_reviewer', 'fraud')).toBe(false);
    expect(can('ad_reviewer', 'audit')).toBe(false);
  });

  it('support: users, advertiser verification, fraud, reports, installs, audit; no finance', () => {
    expect(can('support', 'users')).toBe(true);
    expect(can('support', 'usersModerate')).toBe(true);
    expect(can('support', 'advertisersDecide')).toBe(true);
    expect(can('support', 'fraud')).toBe(true);
    expect(can('support', 'appInstalls')).toBe(true);
    expect(can('support', 'audit')).toBe(true);
    expect(can('support', 'campaignPauseResume')).toBe(true);
    expect(can('support', 'campaignDecide')).toBe(false);
    expect(can('support', 'reviewQueue')).toBe(false);
    expect(can('support', 'adDetail')).toBe(true);
    expect(can('support', 'withdrawals')).toBe(false);
    expect(can('support', 'revenue')).toBe(false);
  });

  it('finance: withdrawals, adjustments, revenue, fraud, audit; read-only users/advertisers/campaigns', () => {
    expect(can('finance', 'withdrawals')).toBe(true);
    expect(can('finance', 'adjustments')).toBe(true);
    expect(can('finance', 'revenue')).toBe(true);
    expect(can('finance', 'fraud')).toBe(true);
    expect(can('finance', 'audit')).toBe(true);
    expect(can('finance', 'users')).toBe(true);
    expect(can('finance', 'usersModerate')).toBe(false);
    expect(can('finance', 'campaigns')).toBe(true);
    expect(can('finance', 'campaignPauseResume')).toBe(false);
    expect(can('finance', 'reviewQueue')).toBe(false);
    expect(can('finance', 'appInstalls')).toBe(false);
  });

  it('anonymous / unknown roles get nothing; every role sees overview + config', () => {
    expect(can(null, 'overview')).toBe(false);
    expect(can(undefined, 'users')).toBe(false);
    for (const role of ALL_ROLES) {
      expect(can(role, 'overview')).toBe(true);
      expect(can(role, 'config')).toBe(true);
    }
    expect(rolesFor('withdrawals')).toEqual(['super_admin', 'finance']);
  });

  it('Phase 4A routes: KYC / alerts / referrals for support+finance, deletion + impersonation for support, run-rules super only', () => {
    for (const key of ['kyc', 'alerts', 'alertsAck', 'referrals'] as const) {
      expect(can('support', key)).toBe(true);
      expect(can('finance', key)).toBe(true);
      expect(can('ad_reviewer', key)).toBe(false);
    }
    expect(can('support', 'deletionRequests')).toBe(true);
    expect(can('support', 'impersonate')).toBe(true);
    expect(can('finance', 'deletionRequests')).toBe(false);
    expect(can('finance', 'impersonate')).toBe(false);
    expect(can('ad_reviewer', 'deletionRequests')).toBe(false);
    expect(rolesFor('alertsRunRules')).toEqual(['super_admin']);
    expect(can('support', 'alertsRunRules')).toBe(false);
    expect(can('finance', 'alertsRunRules')).toBe(false);
    // media reprocessing follows the ad-review matrix
    expect(can('ad_reviewer', 'mediaReprocess')).toBe(true);
    expect(can('support', 'mediaReprocess')).toBe(false);
  });
});
