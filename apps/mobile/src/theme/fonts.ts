// Per-weight subpath imports keep only the 8 font files we use in the bundle (the package
// index would pull in every weight and italic, ~9 MB more).
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { NotoSansEthiopic_400Regular } from '@expo-google-fonts/noto-sans-ethiopic/400Regular';
import { NotoSansEthiopic_500Medium } from '@expo-google-fonts/noto-sans-ethiopic/500Medium';
import { NotoSansEthiopic_600SemiBold } from '@expo-google-fonts/noto-sans-ethiopic/600SemiBold';
import { NotoSansEthiopic_700Bold } from '@expo-google-fonts/noto-sans-ethiopic/700Bold';
import { useFonts } from 'expo-font';
import { Platform } from 'react-native';

export type FontWeight = 'regular' | 'medium' | 'semibold' | 'bold';

export const FONT_MAP = {
  ethiopic: {
    regular: 'NotoSansEthiopic_400Regular',
    medium: 'NotoSansEthiopic_500Medium',
    semibold: 'NotoSansEthiopic_600SemiBold',
    bold: 'NotoSansEthiopic_700Bold',
  },
  latin: {
    regular: 'Inter_400Regular',
    medium: 'Inter_500Medium',
    semibold: 'Inter_600SemiBold',
    bold: 'Inter_700Bold',
  },
} as const;

export const FONT_ASSETS = {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  NotoSansEthiopic_400Regular,
  NotoSansEthiopic_500Medium,
  NotoSansEthiopic_600SemiBold,
  NotoSansEthiopic_700Bold,
};

/** Ethiopic Unicode block (plus supplement/extended). */
const ETHIOPIC_RE = /[\u1200-\u139F\u2D80-\u2DDF\uAB00-\uAB2F]/;

export function containsEthiopic(text: string): boolean {
  return ETHIOPIC_RE.test(text);
}

/** Languages written in the Ethiopic script. Afaan Oromo (om) uses Latin (Qubee). */
export const ETHIOPIC_LANGUAGES = new Set(['am', 'ti']);

/**
 * Picks the font family for a piece of text. Ethiopic text (or an Ethiopic UI language) gets
 * Noto Sans Ethiopic so Amharic/Tigrinya never renders as tofu; everything else gets Inter.
 * On web we add a fallback stack so mixed-script strings render correctly glyph by glyph.
 */
export function resolveFontFamily(weight: FontWeight, language: string, text?: string): string {
  const useEthiopic = (text ? containsEthiopic(text) : false) || ETHIOPIC_LANGUAGES.has(language);
  const primary = useEthiopic ? FONT_MAP.ethiopic[weight] : FONT_MAP.latin[weight];
  if (Platform.OS === 'web') {
    const fallback = useEthiopic ? FONT_MAP.latin[weight] : FONT_MAP.ethiopic[weight];
    return `${primary}, ${fallback}, system-ui, sans-serif`;
  }
  return primary;
}

export function useAppFonts(): [boolean, Error | null] {
  return useFonts(FONT_ASSETS);
}
