import { createContext, useContext, useMemo, type PropsWithChildren } from 'react';
import { useColorScheme } from 'react-native';

import { usePrefsStore } from '@/stores/prefsStore';

import {
  darkColors,
  lightColors,
  MIN_TOUCH_TARGET,
  radii,
  shadows,
  spacing,
  typeScale,
  type ThemeColors,
  type ThemeMode,
} from './tokens';

export interface Theme {
  isDark: boolean;
  mode: ThemeMode;
  colors: ThemeColors;
  spacing: typeof spacing;
  radii: typeof radii;
  shadows: typeof shadows;
  typeScale: typeof typeScale;
  minTouchTarget: number;
}

export function buildTheme(mode: ThemeMode, systemScheme: string | null | undefined): Theme {
  const isDark = mode === 'dark' || (mode === 'system' && systemScheme === 'dark');
  return {
    isDark,
    mode,
    colors: isDark ? darkColors : lightColors,
    spacing,
    radii,
    shadows,
    typeScale,
    minTouchTarget: MIN_TOUCH_TARGET,
  };
}

const ThemeContext = createContext<Theme>(buildTheme('light', 'light'));

export function ThemeProvider({ children }: PropsWithChildren) {
  const systemScheme = useColorScheme();
  const mode = usePrefsStore((s) => s.themeMode);
  const theme = useMemo(() => buildTheme(mode, systemScheme), [mode, systemScheme]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
