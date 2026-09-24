import { PLATFORM_DEFAULTS } from '@rap/shared';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useWithdrawalConfig } from '@/api/queries/withdrawals';
import { BrandMark } from '@/components/ui/BrandMark';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { BRAND_NAME } from '@/config';
import { useLanguage } from '@/i18n/useLanguage';
import { useTheme } from '@/theme/ThemeProvider';
import { formatCoins } from '@/utils/format';

export default function AboutScreen() {
  const { t } = useTranslation();
  const language = useLanguage();
  const { spacing } = useTheme();
  const config = useWithdrawalConfig();
  const coinsPerEtb = config.data?.coinsPerEtb ?? PLATFORM_DEFAULTS.COINS_PER_ETB;
  const rate = t('money.rate', { coins: formatCoins(coinsPerEtb, language) });

  return (
    <Screen header={{ title: t('profile.coinPolicy.title', { brand: BRAND_NAME }) }} testID="settings-about">
      <View style={{ gap: spacing.lg }}>
        <View style={{ alignItems: 'center', paddingVertical: spacing.lg }}>
          <BrandMark size="lg" />
          <Text variant="body" tone="secondary" style={{ marginTop: spacing.sm }}>
            {t('common.tagline')}
          </Text>
        </View>
        {(['p1', 'p2', 'p3', 'p4'] as const).map((key) => (
          <Card key={key}>
            <Text variant="body">{t(`profile.coinPolicy.${key}`, { brand: BRAND_NAME, rate })}</Text>
          </Card>
        ))}
      </View>
    </Screen>
  );
}
