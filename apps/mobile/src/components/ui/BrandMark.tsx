import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { BRAND_NAME, BRAND_NAME_AM } from '@/config';
import { useLanguage } from '@/i18n/useLanguage';
import { useTheme } from '@/theme/ThemeProvider';

import { CoinMark } from './CoinMark';
import { Text } from './Text';

export interface BrandMarkProps {
  size?: 'sm' | 'md' | 'lg';
  /** Colour of the wordmark (defaults to the text colour). */
  color?: string;
  showWordmark?: boolean;
}

/** Coin mark + wordmark. The Amharic wordmark is used when the UI language is Ethiopic. */
export function BrandMark({ size = 'md', color, showWordmark = true }: BrandMarkProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const language = useLanguage();
  const dims = { sm: { mark: 24, variant: 'h3' as const }, md: { mark: 36, variant: 'h2' as const }, lg: { mark: 72, variant: 'display' as const } }[size];
  const word = language === 'am' || language === 'ti' ? BRAND_NAME_AM : BRAND_NAME;
  return (
    <View style={styles.row} accessibilityRole="image" accessibilityLabel={t('a11y.brandLogo', { brand: BRAND_NAME })}>
      <CoinMark size={dims.mark} />
      {showWordmark ? (
        <Text variant={dims.variant} weight="bold" style={{ color: color ?? colors.text }}>
          {word}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', gap: 10 } });
