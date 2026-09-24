import type { PayoutMethod, WithdrawalMethodInfo } from '@rap/shared';
import { ErrorCode, PAYOUT_METHOD_INFO } from '@rap/shared';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { isApiError } from '@/api/errors';
import { useBalance } from '@/api/queries/users';
import { useCreateWithdrawal, useWithdrawalConfig } from '@/api/queries/withdrawals';
import { Badge, Chip } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { Tappable } from '@/components/ui/Tappable';
import { Text } from '@/components/ui/Text';
import {
  maxWithdrawableEtb,
  methodRequiresName,
  normalizeDestination,
  quickAmounts,
  validateAmount,
  validateDestination,
} from '@/features/withdrawals/validation';
import { useLanguage } from '@/i18n/useLanguage';
import { useTheme } from '@/theme/ThemeProvider';
import { errorMessage } from '@/utils/errorMessage';
import { formatCoins, formatEtb } from '@/utils/format';

type Step = 'amount' | 'method' | 'destination' | 'confirm';
const STEPS: Step[] = ['amount', 'method', 'destination', 'confirm'];
const METHOD_ICONS: Record<PayoutMethod, IconName> = { telebirr: 'phone', cbe_birr: 'phone', bank: 'wallet' };

export default function WithdrawScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const language = useLanguage();
  const { colors, spacing, radii } = useTheme();

  const config = useWithdrawalConfig();
  const balance = useBalance();
  const create = useCreateWithdrawal();

  const [step, setStep] = useState<Step>('amount');
  const [amountText, setAmountText] = useState('');
  const [method, setMethod] = useState<WithdrawalMethodInfo | null>(null);
  const [destination, setDestination] = useState('');
  const [destinationName, setDestinationName] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [touched, setTouched] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const balanceCoins = balance.data?.coinBalance ?? 0;
  const validation = useMemo(
    () => (config.data ? validateAmount(amountText, balanceCoins, config.data) : null),
    [amountText, balanceCoins, config.data],
  );
  const maxEtb = config.data ? maxWithdrawableEtb(balanceCoins, config.data.coinsPerEtb) : 0;
  const stepIndex = STEPS.indexOf(step);

  const amountError = (() => {
    if (!touched || !validation || validation.ok || !config.data) return null;
    if (validation.reason === 'invalid') return t('withdraw.invalidAmount');
    if (validation.reason === 'below_min') return t('withdraw.belowMin', { amount: formatEtb(config.data.minWithdrawalEtb, t, language) });
    return t('withdraw.insufficient', { amount: formatEtb(validation.maxEtb, t, language) });
  })();

  const destinationKind = method?.destinationKind ?? 'phone';
  const destinationValid = method ? validateDestination(destinationKind, destination) : false;
  const nameValid = !method || !methodRequiresName(method.method) || destinationName.trim().length >= 2;

  const goBack = () => {
    if (stepIndex === 0) {
      router.back();
      return true;
    }
    setStep(STEPS[stepIndex - 1]);
    return true;
  };

  const submit = async () => {
    if (!validation?.ok || !method) return;
    setSubmitError(null);
    try {
      const item = await create.mutateAsync({
        amountEtb: validation.amountEtb,
        payoutMethod: method.method,
        payoutDestination: normalizeDestination(destinationKind, destination),
        destinationName: destinationName.trim() || undefined,
        bankCode: method.method === 'bank' && bankCode.trim() ? bankCode.trim() : undefined,
      });
      router.replace({ pathname: '/wallet/withdrawals/[id]', params: { id: item.id, created: '1' } });
    } catch (error) {
      if (isApiError(error) && error.code === ErrorCode.INVALID_PAYOUT_DESTINATION) {
        setStep('destination');
      } else if (isApiError(error) && (error.code === ErrorCode.BELOW_MIN_WITHDRAWAL || error.code === ErrorCode.INSUFFICIENT_BALANCE)) {
        setStep('amount');
        setTouched(true);
      }
      setSubmitError(errorMessage(error, t));
    }
  };

  const stepper = (
    <View style={[styles.stepper, { marginBottom: spacing.lg }]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: STEPS.length, now: stepIndex + 1 }}>
      {STEPS.map((s, i) => (
        <View key={s} style={styles.stepItem}>
          <View
            style={[
              styles.stepDot,
              {
                backgroundColor: i <= stepIndex ? colors.primary : colors.surfaceMuted,
                borderColor: i <= stepIndex ? colors.primary : colors.border,
              },
            ]}
          >
            {i < stepIndex ? <Icon name="check" size={12} color={colors.textOnPrimary} strokeWidth={3} /> : null}
          </View>
          <Text variant="caption" weight={i === stepIndex ? 'semibold' : 'regular'} tone={i === stepIndex ? 'default' : 'muted'}>
            {t(`withdraw.steps.${s}`)}
          </Text>
        </View>
      ))}
    </View>
  );

  if (config.isPending || balance.isPending) {
    return (
      <Screen header={{ title: t('withdraw.title') }} testID="withdraw-loading">
        <SkeletonGroup>
          <Skeleton height={24} width="60%" />
          <Skeleton height={56} />
          <Skeleton height={40} width="80%" />
        </SkeletonGroup>
      </Screen>
    );
  }
  if (config.isError || !config.data) {
    return (
      <Screen header={{ title: t('withdraw.title') }}>
        <EmptyState illustration="error" title={t('common.somethingWrong')} body={errorMessage(config.error, t)} action={{ title: t('common.retry'), onPress: () => void config.refetch(), icon: 'refresh' }} />
      </Screen>
    );
  }
  const cfg = config.data;

  const footer = (() => {
    switch (step) {
      case 'amount':
        return (
          <Button
            title={t('common.continue')}
            disabled={!validation?.ok}
            onPress={() => {
              setTouched(true);
              if (validation?.ok) setStep('method');
            }}
            size="lg"
            testID="withdraw-amount-next"
          />
        );
      case 'method':
        return <Button title={t('common.continue')} disabled={!method} onPress={() => setStep('destination')} size="lg" testID="withdraw-method-next" />;
      case 'destination':
        return <Button title={t('common.continue')} disabled={!destinationValid || !nameValid} onPress={() => setStep('confirm')} size="lg" testID="withdraw-destination-next" />;
      case 'confirm':
        return (
          <Button
            title={create.isPending ? t('withdraw.submitting') : t('withdraw.submit')}
            onPress={() => void submit()}
            loading={create.isPending}
            size="lg"
            icon="arrowUpRight"
            testID="withdraw-submit"
          />
        );
    }
  })();

  return (
    <Screen header={{ title: t('withdraw.title'), onBack: goBack }} keyboardAvoiding footer={footer} testID={`withdraw-${step}`}>
      {stepper}

      {step === 'amount' ? (
        <Animated.View entering={FadeIn} style={{ gap: spacing.lg }}>
          <Input
            label={t('withdraw.amountLabel')}
            placeholder={t('withdraw.amountPlaceholder')}
            value={amountText}
            onChangeText={(v) => {
              setAmountText(v);
              setTouched(true);
            }}
            keyboardType="decimal-pad"
            inputMode="decimal"
            autoFocus
            errorText={amountError}
            helperText={t('withdraw.available', { coins: formatCoins(balanceCoins, language), etb: formatEtb(balance.data?.etbEquivalent ?? 0, t, language) })}
            testID="withdraw-amount-input"
            suffix={
              <Text variant="body" weight="semibold" tone="secondary">
                {t('money.etbLabel')}
              </Text>
            }
          />
          <View style={styles.chips}>
            {quickAmounts(cfg, maxEtb).map((amount) => (
              <Chip
                key={amount}
                label={amount === maxEtb ? t('withdraw.quickAll') : formatEtb(amount, t, language)}
                selected={validation?.ok && validation.amountEtb === amount}
                onPress={() => {
                  setAmountText(String(amount));
                  setTouched(true);
                }}
              />
            ))}
          </View>
          <Card tone="muted" padding={spacing.md}>
            <Text variant="bodySmall" tone="secondary">
              {t('withdraw.minimum', { amount: formatEtb(cfg.minWithdrawalEtb, t, language) })}
              {' · '}
              {t('money.rate', { coins: formatCoins(cfg.coinsPerEtb, language) })}
            </Text>
            {validation?.ok ? (
              <Text variant="bodySmall" weight="semibold" style={{ marginTop: 4 }} testID="withdraw-coins-needed">
                {t('withdraw.coinsNeeded', { coins: formatCoins(validation.coins, language) })}
              </Text>
            ) : null}
          </Card>
          {validation?.ok && validation.isLarge ? (
            <Card tone="accent" padding={spacing.md} testID="withdraw-large-notice">
              <View style={styles.noticeRow}>
                <Icon name="eye" size={18} color={colors.accentSoftText} />
                <Text variant="bodySmall" style={{ flex: 1, color: colors.accentSoftText }}>
                  {t('withdraw.largeNotice', { amount: formatEtb(cfg.largeWithdrawalThresholdEtb, t, language) })}
                </Text>
              </View>
            </Card>
          ) : null}
        </Animated.View>
      ) : null}

      {step === 'method' ? (
        <Animated.View entering={FadeIn} style={{ gap: spacing.md }}>
          <Text variant="h3" weight="semibold">
            {t('withdraw.methodTitle')}
          </Text>
          {cfg.methods.map((m) => {
            const selected = method?.method === m.method;
            const info = PAYOUT_METHOD_INFO[m.method as keyof typeof PAYOUT_METHOD_INFO];
            return (
              <Tappable
                key={m.method}
                onPress={() => m.available && setMethod(m)}
                disabled={!m.available}
                accessibilityRole="radio"
                accessibilityState={{ selected, disabled: !m.available }}
                accessibilityLabel={m.label}
                testID={`withdraw-method-${m.method}`}
                style={[
                  styles.methodRow,
                  {
                    borderRadius: radii.lg,
                    backgroundColor: selected ? colors.primarySoft : colors.surface,
                    borderColor: selected ? colors.primary : colors.border,
                    opacity: m.available ? 1 : 0.55,
                    padding: spacing.lg,
                  },
                ]}
              >
                <View style={[styles.methodIcon, { backgroundColor: colors.surfaceMuted, borderRadius: radii.md }]}>
                  <Icon name={METHOD_ICONS[m.method] ?? 'wallet'} size={20} color={colors.text} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text variant="body" weight="semibold">
                    {m.label || info?.label || m.method}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {m.destinationHint || info?.destinationHint}
                  </Text>
                </View>
                {!m.available ? <Badge label={t('withdraw.methodUnavailable')} tone="warning" /> : selected ? <Icon name="circleCheck" color={colors.primary} /> : null}
              </Tappable>
            );
          })}
        </Animated.View>
      ) : null}

      {step === 'destination' && method ? (
        <Animated.View entering={FadeIn} style={{ gap: spacing.lg }}>
          <Text variant="h3" weight="semibold">
            {t('withdraw.destinationTitle')}
          </Text>
          <Input
            label={t(`withdraw.destination.${destinationKind}`)}
            placeholder={method.destinationHint}
            value={destination}
            onChangeText={setDestination}
            keyboardType={destinationKind === 'phone' ? 'phone-pad' : 'number-pad'}
            inputMode={destinationKind === 'phone' ? 'tel' : 'numeric'}
            autoFocus
            errorText={destination.length > 0 && !destinationValid ? t('withdraw.destinationInvalid') : null}
            testID="withdraw-destination-input"
          />
          {methodRequiresName(method.method) ? (
            <>
              <Input
                label={t('withdraw.destinationName')}
                value={destinationName}
                onChangeText={setDestinationName}
                autoCapitalize="words"
                errorText={destinationName.length > 0 && !nameValid ? t('withdraw.destinationNameRequired') : null}
                testID="withdraw-destination-name"
              />
              <Input label={t('withdraw.bankCode')} placeholder={t('withdraw.bankCodePlaceholder')} value={bankCode} onChangeText={setBankCode} autoCapitalize="characters" testID="withdraw-bank-code" />
            </>
          ) : null}
        </Animated.View>
      ) : null}

      {step === 'confirm' && method && validation?.ok ? (
        <Animated.View entering={FadeIn} style={{ gap: spacing.lg }}>
          <Text variant="h3" weight="semibold">
            {t('withdraw.confirmTitle')}
          </Text>
          <Card>
            <SummaryRow label={t('withdraw.summaryAmount')} value={formatEtb(validation.amountEtb, t, language)} strong />
            <SummaryRow label={t('withdraw.summaryCoins')} value={t('money.coins', { count: validation.coins })} />
            <SummaryRow label={t('withdraw.summaryMethod')} value={method.label} />
            <SummaryRow label={t('withdraw.summaryDestination')} value={normalizeDestination(destinationKind, destination)} last />
            {destinationName.trim() ? <SummaryRow label={t('withdraw.destinationName')} value={destinationName.trim()} last /> : null}
          </Card>
          <Text variant="bodySmall" tone="secondary">
            {t('withdraw.confirmBody')}
          </Text>
          {validation.isLarge ? (
            <Text variant="bodySmall" tone="secondary">
              {t('withdraw.largeNotice', { amount: formatEtb(cfg.largeWithdrawalThresholdEtb, t, language) })}
            </Text>
          ) : null}
          {submitError ? (
            <Text variant="bodySmall" tone="danger" accessibilityLiveRegion="polite" testID="withdraw-error">
              {submitError}
            </Text>
          ) : null}
        </Animated.View>
      ) : null}
      {submitError && step !== 'confirm' ? (
        <Text variant="bodySmall" tone="danger" style={{ marginTop: spacing.md }} accessibilityLiveRegion="polite" testID="withdraw-error">
          {submitError}
        </Text>
      ) : null}
    </Screen>
  );
}

function SummaryRow({ label, value, strong, last }: { label: string; value: string; strong?: boolean; last?: boolean }) {
  const { colors, spacing } = useTheme();
  return (
    <View style={[styles.summaryRow, { paddingVertical: spacing.sm, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border }]}>
      <Text variant="bodySmall" tone="muted">
        {label}
      </Text>
      <Text variant={strong ? 'h3' : 'body'} weight={strong ? 'bold' : 'medium'} style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: 'row', justifyContent: 'space-between' },
  stepItem: { alignItems: 'center', gap: 6, flex: 1 },
  stepDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  noticeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  methodRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5 },
  methodIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
});
