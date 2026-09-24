import { BANNED_TOPICS, type BannedTopicKey, type BannedTopicsChecklist } from '@rap/shared';

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
