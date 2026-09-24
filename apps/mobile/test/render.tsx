import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { i18n } from '@/i18n';
import { usePrefsStore } from '@/stores/prefsStore';
import { ThemeProvider } from '@/theme/ThemeProvider';

const initialMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

export function createTestQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
}

export function Providers({ children, client }: { children: ReactNode; client?: QueryClient }) {
  return (
    <SafeAreaProvider initialMetrics={initialMetrics}>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client ?? createTestQueryClient()}>
          <ThemeProvider>{children}</ThemeProvider>
        </QueryClientProvider>
      </I18nextProvider>
    </SafeAreaProvider>
  );
}

export function renderWithProviders(ui: ReactElement, options: RenderOptions & { client?: QueryClient } = {}) {
  const { client, ...rest } = options;
  return render(ui, { wrapper: ({ children }) => <Providers client={client}>{children}</Providers>, ...rest });
}

/** Switches the UI language for a test (and resets it afterwards via `afterEach` in the caller). */
export async function useTestLanguage(language: 'am' | 'en' | 'om' | 'ti') {
  usePrefsStore.getState().setLanguage(language);
  await i18n.changeLanguage(language);
}
