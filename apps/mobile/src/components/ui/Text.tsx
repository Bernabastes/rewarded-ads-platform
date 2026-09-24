import { Children, forwardRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { resolveFontFamily, type FontWeight } from '@/theme/fonts';
import { useTheme } from '@/theme/ThemeProvider';
import type { typeScale } from '@/theme/tokens';

export type TextVariant = keyof typeof typeScale;
export type TextTone =
  | 'default'
  | 'secondary'
  | 'muted'
  | 'primary'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'onPrimary'
  | 'onAccent'
  | 'inherit';

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  weight?: FontWeight;
  tone?: TextTone;
  align?: TextStyle['textAlign'];
}

function extractString(children: React.ReactNode): string | undefined {
  const parts: string[] = [];
  Children.forEach(children, (child) => {
    if (typeof child === 'string' || typeof child === 'number') parts.push(String(child));
  });
  return parts.length ? parts.join('') : undefined;
}

/**
 * Brand text primitive. Chooses Noto Sans Ethiopic for Ethiopic text / Ethiopic UI languages and
 * Inter otherwise, so Amharic never renders as tofu and Latin keeps its intended typeface.
 */
export const Text = forwardRef<RNText, TextProps>(function Text(
  { variant = 'body', weight = 'regular', tone = 'default', align, style, children, ...rest },
  ref,
) {
  const { colors, typeScale } = useTheme();
  const { i18n } = useTranslation();
  const language = i18n.language;
  const content = extractString(children);

  const computed = useMemo<TextStyle>(() => {
    const toneColor: Record<TextTone, string | undefined> = {
      default: colors.text,
      secondary: colors.textSecondary,
      muted: colors.textMuted,
      primary: colors.primary,
      accent: colors.accent,
      success: colors.success,
      warning: colors.warning,
      danger: colors.danger,
      onPrimary: colors.textOnPrimary,
      onAccent: colors.textOnAccent,
      inherit: undefined,
    };
    return {
      fontFamily: resolveFontFamily(weight, language, content),
      fontSize: typeScale[variant].fontSize,
      lineHeight: typeScale[variant].lineHeight,
      color: toneColor[tone],
      textAlign: align,
    };
  }, [colors, typeScale, weight, language, content, variant, tone, align]);

  return (
    <RNText ref={ref} style={[computed, style]} {...rest}>
      {children}
    </RNText>
  );
});
