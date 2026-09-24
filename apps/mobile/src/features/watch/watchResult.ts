import type { AdCompletionResult } from '@rap/shared';
import { create } from 'zustand';

import { isApiError } from '@/api/errors';

export interface WatchResultContext {
  adId: string;
  adTitle: string;
  advertiserName: string;
  rewardCoins: number;
}

interface WatchResultState {
  result: AdCompletionResult | null;
  context: WatchResultContext | null;
  setResult(result: AdCompletionResult, context: WatchResultContext): void;
  clear(): void;
}

/** Hands the completion result from the player to the result screen without serialising it into route params. */
export const useWatchResultStore = create<WatchResultState>()((set) => ({
  result: null,
  context: null,
  setResult: (result, context) => set({ result, context }),
  clear: () => set({ result: null, context: null }),
}));

/**
 * Calls the idempotent completion endpoint, retrying transient (network / 5xx) failures with
 * linear back-off. Business rejections (4xx) are returned to the caller immediately.
 */
export async function completeWithRetry<T>(
  attempt: () => Promise<T>,
  options: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const attempts = options.attempts ?? 4;
  const delayMs = options.delayMs ?? 1500;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
      const transient = !isApiError(error) || error.isNetworkError || error.statusCode >= 500;
      if (!transient || i === attempts - 1) throw error;
      await sleep(delayMs * (i + 1));
    }
  }
  throw lastError;
}
