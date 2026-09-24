import { BANNED_TOPICS } from '@rap/shared';
import { describe, expect, it } from 'vitest';
import { allChecks, checkedCount, composeRejectionReason, emptyChecks, isChecklistComplete, missingTopics, toChecklist } from './review-rules';

describe('banned-topics checklist gating', () => {
  it('starts with every topic unconfirmed and approval blocked', () => {
    const checks = emptyChecks();
    expect(Object.keys(checks)).toEqual(BANNED_TOPICS.map((t) => t.key));
    expect(isChecklistComplete(checks)).toBe(false);
    expect(checkedCount(checks)).toBe(0);
    expect(missingTopics(checks)).toHaveLength(BANNED_TOPICS.length);
  });

  it('is only complete when EVERY key is explicitly true', () => {
    const almost = allChecks(true);
    almost.weapons = false;
    expect(isChecklistComplete(almost)).toBe(false);
    expect(missingTopics(almost)).toEqual(['weapons']);
    expect(checkedCount(almost)).toBe(BANNED_TOPICS.length - 1);
    expect(isChecklistComplete(allChecks(true))).toBe(true);
  });

  it('treats missing keys, null and undefined as unconfirmed (server semantics)', () => {
    expect(isChecklistComplete({ alcohol: true })).toBe(false);
    expect(isChecklistComplete(null)).toBe(false);
    expect(isChecklistComplete(undefined)).toBe(false);
    // truthy-but-not-true values must not count
    expect(isChecklistComplete({ ...allChecks(true), alcohol: 1 as unknown as boolean })).toBe(false);
  });

  it('builds the DTO payload, omitting empty notes', () => {
    const checks = allChecks(true);
    expect(toChecklist(checks, '   ')).toEqual({ checks });
    expect(toChecklist(checks, ' fine ')).toEqual({ checks, notes: 'fine' });
  });
});

describe('composeRejectionReason', () => {
  it('combines category, flagged topic labels and free text', () => {
    expect(composeRejectionReason('banned_topic', 'Raffle for viewers', ['gambling', 'alcohol'])).toBe(
      'Contains a banned topic [Gambling / betting / chance-based promotions, Alcohol]: Raffle for viewers',
    );
  });
  it('works without detail text', () => {
    expect(composeRejectionReason('quality', '   ')).toBe('Poor media quality / broken creative');
  });
});
