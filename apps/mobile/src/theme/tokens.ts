/**
 * Design tokens shared (by value) with the advertiser and admin web apps - spec §10.
 * Warm, optimistic, trustworthy. Coins are a flat two-tone mark (forest + terracotta), never metallic.
 */
import { Platform, type ViewStyle } from 'react-native';

export const palette = {
  forest: {
    50: '#EEF6F2',
    100: '#D7EAE0',
    200: '#B0D5C2',
    300: '#7FB89D',
    400: '#4E9877',
    500: '#2E7D5B',
    600: '#1F6A4C',
    700: '#175540',
    800: '#124334',
    900: '#0C2F25',
    950: '#071C16',
  },
  terracotta: {
    50: '#FDF3EC',
    100: '#FAE2D1',
    200: '#F5C3A3',
    300: '#EE9E6E',
    400: '#E67B41',
    500: '#D9622B',
    600: '#B84D1F',
    700: '#933B1A',
    800: '#6E2C15',
    900: '#4A1E0F',
  },
  stone: {
    50: '#FAF8F5',
    100: '#F3F0EB',
    200: '#E6E1D9',
    300: '#D1CAC0',
    400: '#A69E93',
    500: '#7D756B',
    600: '#5C554D',
    700: '#463F39',
    800: '#2E2925',
    900: '#1D1A17',
    950: '#121010',
  },
  semantic: {
    success: '#1E9E6A',
    warning: '#E1A12E',
    danger: '#D24B3F',
    info: '#3B72E0',
  },
  white: '#FFFFFF',
  black: '#000000',
} as const;

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceElevated: string;
  surfaceMuted: string;
  border: string;
  borderStrong: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  textOnPrimary: string;
  textOnAccent: string;
  primary: string;
  primaryStrong: string;
  primarySoft: string;
  primarySoftText: string;
  accent: string;
  accentSoft: string;
  accentSoftText: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  info: string;
  infoSoft: string;
  skeleton: string;
  skeletonHighlight: string;
  overlay: string;
  tabBar: string;
  tabIconInactive: string;
  coinOuter: string;
  coinInner: string;
}

export const lightColors: ThemeColors = {
  background: palette.stone[50],
  surface: palette.white,
  surfaceElevated: palette.white,
  surfaceMuted: palette.stone[100],
  border: palette.stone[200],
  borderStrong: palette.stone[300],
  text: palette.stone[900],
  textSecondary: palette.stone[600],
  textMuted: palette.stone[500],
  textOnPrimary: palette.white,
  textOnAccent: palette.white,
  primary: palette.forest[600],
  primaryStrong: palette.forest[700],
  primarySoft: palette.forest[50],
  primarySoftText: palette.forest[700],
  accent: palette.terracotta[500],
  accentSoft: palette.terracotta[50],
  accentSoftText: palette.terracotta[700],
  success: palette.semantic.success,
  successSoft: '#E4F5EC',
  warning: palette.semantic.warning,
  warningSoft: '#FBF1DA',
  danger: palette.semantic.danger,
  dangerSoft: '#FBE5E3',
  info: palette.semantic.info,
  infoSoft: '#E5EDFB',
  skeleton: palette.stone[200],
  skeletonHighlight: palette.stone[100],
  overlay: 'rgba(29, 26, 23, 0.55)',
  tabBar: palette.white,
  tabIconInactive: palette.stone[400],
  coinOuter: palette.forest[500],
  coinInner: palette.terracotta[400],
};

export const darkColors: ThemeColors = {
  background: palette.stone[950],
  surface: palette.stone[900],
  surfaceElevated: palette.stone[800],
  surfaceMuted: palette.stone[800],
  border: palette.stone[800],
  borderStrong: palette.stone[700],
  text: palette.stone[50],
  textSecondary: palette.stone[300],
  textMuted: palette.stone[400],
  textOnPrimary: palette.forest[950],
  textOnAccent: palette.terracotta[900],
  primary: palette.forest[400],
  primaryStrong: palette.forest[300],
  primarySoft: palette.forest[900],
  primarySoftText: palette.forest[200],
  accent: palette.terracotta[400],
  accentSoft: palette.terracotta[900],
  accentSoftText: palette.terracotta[200],
  success: '#3DBE87',
  successSoft: '#123526',
  warning: '#EBB24C',
  warningSoft: '#3A2D12',
  danger: '#E4685D',
  dangerSoft: '#3D1A17',
  info: '#6B95EA',
  infoSoft: '#182849',
  skeleton: palette.stone[800],
  skeletonHighlight: palette.stone[700],
  overlay: 'rgba(0, 0, 0, 0.65)',
  tabBar: palette.stone[900],
  tabIconInactive: palette.stone[500],
  coinOuter: palette.forest[400],
  coinInner: palette.terracotta[400],
};

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

export const radii = { sm: 8, md: 12, lg: 16, xl: 24, full: 999 } as const;

const SHADOW_RGB = '46, 41, 37'; // #2E2925

/**
 * One elevation level. react-native-web deprecates the `shadow*` styles in favour of CSS `boxShadow`, so web gets the
 * equivalent box-shadow (same offset / blur / colour); iOS keeps the native shadow and Android its elevation.
 */
function shadow(opacity: number, radius: number, offsetY: number, elevation: number): ViewStyle {
  return (
    Platform.select<ViewStyle>({
      web: { boxShadow: `0 ${offsetY}px ${radius}px rgba(${SHADOW_RGB}, ${opacity})` },
      default: {
        shadowColor: '#2E2925',
        shadowOpacity: opacity,
        shadowRadius: radius,
        shadowOffset: { width: 0, height: offsetY },
        elevation,
      },
    }) ?? {}
  );
}

/** Soft, warm, low-opacity shadows (never harsh). */
export const shadows = {
  none: {} as ViewStyle,
  sm: shadow(0.06, 8, 2, 1),
  md: shadow(0.08, 16, 6, 3),
  lg: shadow(0.12, 28, 12, 6),
} as const;

export const typeScale = {
  display: { fontSize: 36, lineHeight: 44 },
  h1: { fontSize: 28, lineHeight: 36 },
  h2: { fontSize: 22, lineHeight: 30 },
  h3: { fontSize: 18, lineHeight: 26 },
  body: { fontSize: 16, lineHeight: 24 },
  bodySmall: { fontSize: 14, lineHeight: 21 },
  caption: { fontSize: 12, lineHeight: 18 },
  label: { fontSize: 13, lineHeight: 18 },
} as const;

/** Minimum touch target (pt) for every interactive element. */
export const MIN_TOUCH_TARGET = 44;

export type ThemeMode = 'system' | 'light' | 'dark';
