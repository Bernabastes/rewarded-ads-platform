import type { AdFeedMeta } from '@rap/shared';

export type FeedEmptyKind = 'daily_done' | 'frequency_capped' | 'no_ads';

/**
 * Which designed empty state to show when the feed has no ads:
 *  - the daily cap is reached → "done for today";
 *  - everything left today is hidden by advertiser / campaign frequency caps → "come back tomorrow";
 *  - otherwise plain "no ads right now".
 */
export function feedEmptyKind(meta: Pick<AdFeedMeta, 'dailyRemaining' | 'hiddenByFrequencyCap'> | null | undefined): FeedEmptyKind {
  if (meta && meta.dailyRemaining === 0) return 'daily_done';
  if (meta && (meta.hiddenByFrequencyCap ?? 0) > 0) return 'frequency_capped';
  return 'no_ads';
}
