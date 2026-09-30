import { BANNED_TOPICS, type BannedTopicKey, type BannedTopicsChecklist, type MediaStatus, type MediaProbe } from '@rap/shared';

export type Checks = Record<BannedTopicKey, boolean>;

export function emptyChecks(): Checks {
  return Object.fromEntries(BANNED_TOPICS.map((t) => [t.key, false])) as Checks;
}

export function allChecks(value: boolean): Checks {
  return Object.fromEntries(BANNED_TOPICS.map((t) => [t.key, value])) as Checks;
}

/** Keys the reviewer has not (yet) explicitly confirmed absent. */
export function missingTopics(checks: Partial<Record<string, boolean>> | null | undefined): BannedTopicKey[] {
  return BANNED_TOPICS.filter((t) => checks?.[t.key] !== true).map((t) => t.key);
}

/** Approval is only allowed when EVERY banned topic is ticked (server enforces the same). */
export function isChecklistComplete(checks: Partial<Record<string, boolean>> | null | undefined): boolean {
  return missingTopics(checks).length === 0;
}

export function checkedCount(checks: Partial<Record<string, boolean>> | null | undefined): number {
  return BANNED_TOPICS.length - missingTopics(checks).length;
}

export function toChecklist(checks: Checks, notes?: string): BannedTopicsChecklist {
  const trimmed = notes?.trim();
  return trimmed ? { checks, notes: trimmed } : { checks };
}

/** Structured rejection reasons offered in the reject dialog (free text is appended). */
export const REJECTION_REASONS = [
  { key: 'banned_topic', label: 'Contains a banned topic' },
  { key: 'misleading', label: 'Misleading or unverifiable claims' },
  { key: 'quality', label: 'Poor media quality / broken creative' },
  { key: 'mismatch', label: 'Creative does not match the campaign' },
  { key: 'offensive', label: 'Offensive or inappropriate content' },
  { key: 'attention_question', label: 'Attention question is wrong or unanswerable' },
  { key: 'other', label: 'Other (explain below)' },
] as const;
export type RejectionReasonKey = (typeof REJECTION_REASONS)[number]['key'];

export function composeRejectionReason(key: RejectionReasonKey, detail: string, flaggedTopics: BannedTopicKey[] = []): string {
  const label = REJECTION_REASONS.find((r) => r.key === key)?.label ?? 'Rejected';
  const topics = flaggedTopics.length
    ? ` [${flaggedTopics.map((k) => BANNED_TOPICS.find((t) => t.key === k)?.label ?? k).join(', ')}]`
    : '';
  const text = detail.trim();
  return text ? `${label}${topics}: ${text}` : `${label}${topics}`;
}

/* ------------------------------ media pipeline ------------------------------ */

export interface MediaFacts {
  mediaStatus: MediaStatus;
  mediaProbe: MediaProbe | null;
  durationDeclaredSeconds: number | null;
  durationProbedSeconds: number | null;
  mediaError: string | null;
}

/** The API refuses approval (422 MEDIA_NOT_READY) while the pipeline is running or has failed. */
export function isMediaReady(status: MediaStatus): boolean {
  return status === 'ready' || status === 'duration_corrected';
}

/** Why Approve must stay disabled because of the media pipeline (null = media is fine). */
export function mediaApproveBlock(ad: Pick<MediaFacts, 'mediaStatus' | 'mediaError'>): string | null {
  if (ad.mediaStatus === 'processing') return 'Media is still being probed / transcoded. Approve becomes available once the pipeline finishes.';
  if (ad.mediaStatus === 'failed') return `Media processing failed${ad.mediaError ? `: ${ad.mediaError}` : ''}. Reprocess the media (or reject the creative) before approving.`;
  return null;
}

/** "15s → 17s" style summary when the pipeline corrected the declared duration. */
export function durationCorrectionLabel(ad: Pick<MediaFacts, 'durationDeclaredSeconds' | 'durationProbedSeconds'>): string | null {
  if (ad.durationDeclaredSeconds === null || ad.durationProbedSeconds === null) return null;
  if (Math.abs(ad.durationDeclaredSeconds - ad.durationProbedSeconds) <= 1) return null;
  return `${ad.durationDeclaredSeconds}s → ${ad.durationProbedSeconds}s`;
}

/** "1280×720 h264" for the probe details. */
export function probeSummary(probe: MediaProbe | null): string | null {
  if (!probe) return null;
  const parts: string[] = [];
  if (probe.width && probe.height) parts.push(`${probe.width}×${probe.height}`);
  if (probe.codec) parts.push(probe.codec);
  if (probe.container) parts.push(probe.container);
  return parts.length ? parts.join(' ') : null;
}
