import type { LedgerEntry, LedgerSourceType } from '@rap/shared';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { BRAND_NAME } from '@/config';
import { useLanguage } from '@/i18n/useLanguage';
import { useTheme } from '@/theme/ThemeProvider';
import { dayKey, formatTime } from '@/utils/format';

export const SOURCE_ICONS: Record<LedgerSourceType, IconName> = {
  ad_view: 'play',
  survey: 'clipboard',
  app_install: 'download',
  withdrawal: 'arrowUpRight',
  withdrawal_reversal: 'arrowDownLeft',
  admin_adjustment: 'sliders',
  reconciliation: 'refresh',
  referral: 'gift',
};

export interface LedgerSection {
  key: string;
  data: LedgerEntry[];
}

/** Groups entries (already sorted newest-first by the API) into local calendar days. */
export function groupLedgerByDay(entries: LedgerEntry[]): LedgerSection[] {
  const sections: LedgerSection[] = [];
  for (const entry of entries) {
    const key = dayKey(entry.createdAt);
    const last = sections[sections.length - 1];
    if (last && last.key === key) last.data.push(entry);
    else sections.push({ key, data: [entry] });
  }
  return sections;
}

export function LedgerRow({ entry }: { entry: LedgerEntry }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const { colors, radii, spacing } = useTheme();
  const positive = entry.amount >= 0;
  const iconName = SOURCE_ICONS[entry.sourceType] ?? 'circleDot';

  return (
    <View style={[styles.row, { paddingVertical: spacing.md }]} accessible testID={`ledger-${entry.id}`}>
      <View
        style={[
          styles.icon,
          { borderRadius: radii.md, backgroundColor: positive ? colors.successSoft : colors.surfaceMuted },
        ]}
      >
        <Icon name={iconName} size={18} color={positive ? colors.success : colors.textSecondary} filled={iconName === 'play'} />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="body" weight="medium" numberOfLines={1}>
          {t(`wallet.sources.${entry.sourceType}`, { brand: BRAND_NAME, defaultValue: entry.sourceType })}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {entry.description ? `${formatTime(entry.createdAt, language)} · ${entry.description}` : formatTime(entry.createdAt, language)}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text variant="body" weight="bold" style={{ color: positive ? colors.success : colors.text }}>
          {positive
            ? t('money.plusCoins', { count: entry.amount })
            : t('money.minusCoins', { count: Math.abs(entry.amount) })}
        </Text>
        <Text variant="caption" tone="muted">
          {t('wallet.balanceAfter', { coins: t('money.coins', { count: entry.balanceAfter }) })}
        </Text>
      </View>
    </View>
  );
}

export function LedgerRowSkeleton() {
  const { spacing } = useTheme();
  return (
    <View style={[styles.row, { paddingVertical: spacing.md }]}>
      <Skeleton height={40} width={40} radius={12} />
      <View style={{ flex: 1, gap: 6 }}>
        <Skeleton height={16} width="60%" />
        <Skeleton height={12} width="35%" />
      </View>
      <Skeleton height={18} width={70} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
