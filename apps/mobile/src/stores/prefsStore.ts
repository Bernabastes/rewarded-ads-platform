import type { Language } from '@rap/shared';
import { DEFAULT_LANGUAGE } from '@rap/shared';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { ThemeMode } from '@/theme/tokens';
import { kvStorage } from '@/utils/storage';

export interface RecentAd {
  id: string;
  title: string;
  advertiserName: string;
  watchedAt: string;
}

interface PrefsState {
  themeMode: ThemeMode;
  language: Language;
  hasSeenWelcome: boolean;
  /** Last ads the user opened - lets Profile > "Report an ad" work without a server-side history endpoint. */
  recentAds: RecentAd[];
  hydrated: boolean;
  setThemeMode(mode: ThemeMode): void;
  setLanguage(language: Language): void;
  setHasSeenWelcome(seen: boolean): void;
  rememberAd(ad: Omit<RecentAd, 'watchedAt'>): void;
  setHydrated(hydrated: boolean): void;
}

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set) => ({
      themeMode: 'system',
      language: DEFAULT_LANGUAGE,
      hasSeenWelcome: false,
      recentAds: [],
      hydrated: false,
      setThemeMode: (themeMode) => set({ themeMode }),
      setLanguage: (language) => set({ language }),
      setHasSeenWelcome: (hasSeenWelcome) => set({ hasSeenWelcome }),
      rememberAd: (ad) =>
        set((state) => ({
          recentAds: [
            { ...ad, watchedAt: new Date().toISOString() },
            ...state.recentAds.filter((existing) => existing.id !== ad.id),
          ].slice(0, 20),
        })),
      setHydrated: (hydrated) => set({ hydrated }),
    }),
    {
      name: 'gize.prefs.v1',
      storage: createJSONStorage(() => kvStorage),
      partialize: ({ themeMode, language, hasSeenWelcome, recentAds }) => ({
        themeMode,
        language,
        hasSeenWelcome,
        recentAds,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
      },
    },
  ),
);
