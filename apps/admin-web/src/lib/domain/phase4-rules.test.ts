import { describe, expect, it } from 'vitest';
import { deletionExecuteBlock, deletionIsDue } from './data-rights-rules';
import { documentsExpireAt, formatRemaining, kycDecisionBlock, kycReviewWarnings, parseProviderResult, preCheckVerdict } from './kyc-rules';
import { durationCorrectionLabel, isMediaReady, mediaApproveBlock, probeSummary } from './review-rules';

describe('media pipeline gating (MEDIA_NOT_READY)', () => {
  it('blocks approval while processing or failed, allows ready / duration_corrected', () => {
    expect(mediaApproveBlock({ mediaStatus: 'processing', mediaError: null })).toMatch(/still being probed/);
    expect(mediaApproveBlock({ mediaStatus: 'failed', mediaError: 'moov atom not found' })).toMatch(/failed: moov atom not found/);
    expect(mediaApproveBlock({ mediaStatus: 'ready', mediaError: null })).toBeNull();
    expect(mediaApproveBlock({ mediaStatus: 'duration_corrected', mediaError: null })).toBeNull();
    expect(isMediaReady('processing')).toBe(false);
    expect(isMediaReady('duration_corrected')).toBe(true);
  });

  it('summarises the probe and the duration correction', () => {
    expect(durationCorrectionLabel({ durationDeclaredSeconds: 15, durationProbedSeconds: 18 })).toBe('15s → 18s');
    expect(durationCorrectionLabel({ durationDeclaredSeconds: 15, durationProbedSeconds: 15.6 })).toBeNull();
    expect(durationCorrectionLabel({ durationDeclaredSeconds: 15, durationProbedSeconds: null })).toBeNull();
    expect(probeSummary({ durationSeconds: 18, codec: 'h264', width: 1280, height: 720, bitrate: null, container: null })).toBe('1280×720 h264');
    expect(probeSummary(null)).toBeNull();
  });
});

describe('KYC review rules', () => {
  it('parses the provider pre-check and grades it', () => {
    const strong = parseProviderResult({ provider: 'fayda', mock: true, found: true, score: 0.97, match: { fullName: true, dateOfBirth: true } });
    expect(strong).toMatchObject({ provider: 'fayda', mock: true, score: 0.97 });
    expect(preCheckVerdict(strong)).toBe('strong');
    expect(preCheckVerdict(parseProviderResult({ provider: 'fayda', mock: true, found: true, score: 0.4, match: { fullName: false, dateOfBirth: true } }))).toBe('weak');
    expect(preCheckVerdict(parseProviderResult({ provider: 'fayda', mock: true, found: false, score: 0, match: {} }))).toBe('not_found');
    expect(preCheckVerdict(parseProviderResult({ provider: 'fayda', error: 'timeout' }))).toBe('error');
    expect(parseProviderResult(null)).toBeNull();
  });

  it('collects reviewer warnings without hard-blocking the decision', () => {
    const warnings = kycReviewWarnings({
      profileMatch: { fullName: false, dateOfBirth: true },
      duplicateIdentityUsers: 1,
      providerResult: { provider: 'fayda', mock: true, found: true, score: 0.4, match: { fullName: false, dateOfBirth: true } },
    });
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toMatch(/name differs/);
    expect(warnings[1]).toMatch(/1 other account submitted/);
    expect(warnings[2]).toMatch(/weak match/);
    expect(kycReviewWarnings({ profileMatch: { fullName: true, dateOfBirth: true }, duplicateIdentityUsers: 0, providerResult: null })).toEqual([]);
    expect(kycDecisionBlock('pending', true)).toBeNull();
    expect(kycDecisionBlock('approved', true)).toMatch(/already been approved/);
    expect(kycDecisionBlock('pending', false)).toMatch(/role cannot decide/);
  });

  it('computes the presigned-link expiry from the shortest TTL and formats the countdown', () => {
    const fetchedAt = 1_000_000;
    const detail = {
      documents: {
        front: { url: 'f', expiresInSeconds: 300 },
        back: { url: 'b', expiresInSeconds: 120 },
        selfie: { url: 's', expiresInSeconds: 300 },
      },
    };
    expect(documentsExpireAt(detail, fetchedAt)).toBe(fetchedAt + 120_000);
    expect(formatRemaining(fetchedAt + 120_000, fetchedAt)).toBe('02:00');
    expect(formatRemaining(fetchedAt + 65_000, fetchedAt)).toBe('01:05');
    expect(formatRemaining(fetchedAt, fetchedAt + 5_000)).toBe('00:00');
  });
});

describe('deletion request rules', () => {
  it('blocks execution while withdrawals are in flight and explains why', () => {
    expect(deletionExecuteBlock({ status: 'pending', pendingWithdrawals: 0 })).toBeNull();
    expect(deletionExecuteBlock({ status: 'pending', pendingWithdrawals: 1 })).toMatch(/1 withdrawal is still in flight/);
    expect(deletionExecuteBlock({ status: 'pending', pendingWithdrawals: 2 })).toMatch(/2 withdrawals are still in flight/);
    expect(deletionExecuteBlock({ status: 'executed', pendingWithdrawals: 0 })).toMatch(/already executed/);
  });

  it('flags overdue pending requests', () => {
    const now = Date.parse('2026-10-12T00:00:00.000Z');
    expect(deletionIsDue({ status: 'pending', scheduledFor: '2026-10-11T12:00:00.000Z' }, now)).toBe(true);
    expect(deletionIsDue({ status: 'pending', scheduledFor: '2026-10-13T12:00:00.000Z' }, now)).toBe(false);
    expect(deletionIsDue({ status: 'executed', scheduledFor: '2026-10-11T12:00:00.000Z' }, now)).toBe(false);
  });
});
