import type { AdminKycDetail, KycStatus } from '@rap/shared';

/** Shape of the id-registry pre-check stored on a submission (mock Fayda today; advisory only). */
export interface ProviderPreCheck {
  provider: string;
  mock: boolean;
  found: boolean;
  score: number;
  match: { fullName: boolean; dateOfBirth: boolean };
  error?: string;
}

export function parseProviderResult(raw: Record<string, unknown> | null | undefined): ProviderPreCheck | null {
  if (!raw || typeof raw !== 'object') return null;
  const match = (raw.match ?? {}) as Record<string, unknown>;
  return {
    provider: typeof raw.provider === 'string' ? raw.provider : 'unknown',
    mock: raw.mock === true,
    found: raw.found !== false,
    score: typeof raw.score === 'number' ? raw.score : 0,
    match: { fullName: match.fullName === true, dateOfBirth: match.dateOfBirth === true },
    error: typeof raw.error === 'string' ? raw.error : undefined,
  };
}

export type PreCheckVerdict = 'strong' | 'weak' | 'not_found' | 'error';

/** Tone for the pre-check card. Thresholds mirror the mock provider (0.97 strong, 0.4 mismatch, 0 not found). */
export function preCheckVerdict(result: ProviderPreCheck | null): PreCheckVerdict | null {
  if (!result) return null;
  if (result.error) return 'error';
  if (!result.found) return 'not_found';
  return result.score >= 0.8 && result.match.fullName && result.match.dateOfBirth ? 'strong' : 'weak';
}

/** Epoch ms at which the presigned document links stop working (shortest of the three). */
export function documentsExpireAt(detail: Pick<AdminKycDetail, 'documents'>, fetchedAt: number): number {
  const ttls = [detail.documents.front.expiresInSeconds, detail.documents.selfie.expiresInSeconds, detail.documents.back?.expiresInSeconds].filter(
    (v): v is number => typeof v === 'number',
  );
  const ttl = ttls.length ? Math.min(...ttls) : 0;
  return fetchedAt + ttl * 1000;
}

/** Human "mm:ss" remaining until `expiresAt`, clamped at zero. */
export function formatRemaining(expiresAt: number, now: number): string {
  const total = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Why a decision is not possible right now (null = allowed). */
export function kycDecisionBlock(status: KycStatus, canDecide: boolean): string | null {
  if (status !== 'pending') return `This submission has already been ${status}.`;
  if (!canDecide) return 'Your role cannot decide KYC submissions.';
  return null;
}

/** Things a reviewer should look at before approving; surfaced as warnings, never as hard blocks (the admin decides). */
export function kycReviewWarnings(detail: Pick<AdminKycDetail, 'profileMatch' | 'duplicateIdentityUsers' | 'providerResult'>): string[] {
  const out: string[] = [];
  if (!detail.profileMatch.fullName) out.push('Submitted name differs from the profile name.');
  if (!detail.profileMatch.dateOfBirth) out.push('Submitted date of birth differs from the profile.');
  const duplicates = detail.duplicateIdentityUsers.length;
  if (duplicates > 0) {
    out.push(
      `${duplicates} other account${duplicates === 1 ? '' : 's'} submitted the same id number (${detail.duplicateIdentityUsers.map((u) => u.phoneNumber).join(', ')}).`,
    );
  }
  const verdict = preCheckVerdict(parseProviderResult(detail.providerResult));
  if (verdict === 'weak') out.push('Registry pre-check reports a weak match.');
  if (verdict === 'not_found') out.push('Registry pre-check could not find this id number.');
  if (verdict === 'error') out.push('Registry pre-check failed; decide from the documents alone.');
  return out;
}
