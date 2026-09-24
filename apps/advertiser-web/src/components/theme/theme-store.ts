import { useSyncExternalStore } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'gize.theme';

const listeners = new Set<() => void>();

function readPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
  } catch {
    return 'system';
  }
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

let preference: ThemePreference = typeof window === 'undefined' ? 'system' : readPreference();

function resolve(pref: ThemePreference): ResolvedTheme {
  return pref === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : pref;
}

function apply() {
  if (typeof document === 'undefined') return;
  const resolved = resolve(preference);
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  document.documentElement.style.colorScheme = resolved;
}

function emit() {
  apply();
  for (const listener of listeners) listener();
}

export const themeStore = {
  getPreference: (): ThemePreference => preference,
  getResolved: (): ResolvedTheme => resolve(preference),
  setPreference(next: ThemePreference) {
    preference = next;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // storage unavailable (private mode) – keep in memory
    }
    emit();
  },
  toggle() {
    themeStore.setPreference(resolve(preference) === 'dark' ? 'light' : 'dark');
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

if (typeof window !== 'undefined' && window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (preference === 'system') emit();
  });
  apply();
}

export function useTheme() {
  const pref = useSyncExternalStore(themeStore.subscribe, themeStore.getPreference, () => 'system' as const);
  const resolved = useSyncExternalStore(themeStore.subscribe, themeStore.getResolved, () => 'light' as const);
  return { preference: pref, resolved, setPreference: themeStore.setPreference, toggle: themeStore.toggle };
}
