import type { PayoutMethod, WithdrawalMethodInfo } from '@rap/shared';
import { ErrorCode, PAYOUT_METHOD_INFO } from '@rap/shared';
import { randomUUID } from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';

import { isApiError } from '@/api/errors';
import { useBalance } from '@/api/queries/users';
import { useCreateWithdrawal, useWithdrawalConfig } from '@/api/queries/withdrawals';
import { Badge, Chip } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Screen } from '@/components/ui/Screen';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { Tappable } from '@/components/ui/Tappable';
import { Text } from '@/components/ui/Text';
import { destinationReducer, initialDestinationState, isVerified, type RememberedDestination } from '@/features/withdrawals/destinationFlow';
import { DestinationStep } from '@/features/withdrawals/DestinationStep';
import { loadRememberedDestinations, rememberDestination } from '@/features/withdrawals/rememberedDestinations';
import { createIntentKeys } from '@/features/withdrawals/submitWithdrawal';
import { kycProjection, maxWithdrawableEtb, quickAmounts, validateAmount } from '@/features/withdrawals/validation';
import { useLanguage } from '@/i18n/useLanguage';
import { useTheme } from '@/theme/ThemeProvider';
import { errorMessage } from '@/utils/errorMessage';
import { formatCoins, formatEtb } from '@/utils/format';

type Step = 'amount' | 'method' | 'destination' | 'confirm';
const STEPS: Step[] = ['amount', 'method', 'destination', 'confirm'];
const METHOD_ICONS: Record<PayoutMethod, IconName> = { telebirr: 'phone', cbe_birr: 'phone', bank: 'wallet' };

interface KycGate {
  projectedEtb: number;
  thresholdEtb: number;
}

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
  const [destination, dispatch] = useReducer(destinationReducer, initialDestinationState);
  const [destinationName, setDestinationName] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [remembered, setRemembered] = useState<RememberedDestination[]>([]);
  const [touched, setTouched] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [kycGate, setKycGate] = useState<KycGate | null>(null);
  // One Idempotency-Key per submit intent (same payload → same key on retry; new payload → new key).
  const intentKeys = useRef(createIntentKeys(() => randomUUID()));

  useEffect(() => {
    void loadRememberedDestinations().then(setRemembered);
  }, []);

  const balanceCoins = balance.data?.coinBalance ?? 0;
  const validation = useMemo(
    () => (config.data ? validateAmount(amountText, balanceCoins, config.data) : null),
    [amountText, balanceCoins, config.data],
  );
  const maxEtb = config.data ? maxWithdrawableEtb(balanceCoins, config.data.coinsPerEtb) : 0;
  const stepIndex = STEPS.indexOf(step);
  const kyc = useMemo(
    () => (config.data ? kycProjection(config.data, validation?.ok ? validation.amountEtb : null) : null),
    [config.data, validation],
  );

  const amountError = (() => {
    if (!touched || !validation || validation.ok || !config.data) return null;
    if (validation.reason === 'invalid') return t('withdraw.invalidAmount');
    if (validation.reason === 'below_min') return t('withdraw.belowMin', { amount: formatEtb(config.data.minWithdrawalEtb, t, language) });
    return t('withdraw.insufficient', { amount: formatEtb(validation.maxEtb, t, language) });
  })();

  const verified = isVerified(destination) ? destination.phase : null;

  const chooseMethod = (m: WithdrawalMethodInfo) => {
    if (!m.available) return;
    if (method?.method !== m.method) {
      dispatch({ type: 'reset' });
      setDestinationName('');
      setBankCode('');
    }
    setMethod(m);
  };

  const goBack = () => {
    if (stepIndex === 0) {
      router.back();
      return true;
    }
    setStep(STEPS[stepIndex - 1]);
    return true;
  };

  const submit = async () => {
    if (!validation?.ok || !method || !verified) return;
    setSubmitError(null);
    const dto = {
      amountEtb: validation.amountEtb,
      payoutMethod: method.method,
      payoutDestination: verified.payoutDestination,
      destinationName: destinationName.trim() || undefined,
      bankCode: method.method === 'bank' && bankCode.trim() ? bankCode.trim() : undefined,
    };
    const intent = intentKeys.current.keyFor(dto);
    try {
      const result = await create.mutateAsync({ dto, idempotencyKey: intent.key, intentStartedAt: intent.startedAt });
      intentKeys.current.reset();
      await rememberDestination({
        payoutMethod: method.method,
        destination: verified.payoutDestination,
        accountName: verified.accountName ?? result.item.destinationAccountName ?? null,
        bankCode: dto.bankCode ?? null,
      });
      router.replace({ pathname: '/wallet/withdrawals/[id]', params: { id: result.item.id, created: '1' } });
    } catch (error) {
      if (isApiError(error)) {
        switch (error.code) {
          case ErrorCode.KYC_REQUIRED: {
            const details = error.details as Partial<KycGate> | undefined;
            setKycGate({
              projectedEtb: details?.projectedEtb ?? kyc?.projectedEtb ?? validation.amountEtb,
              thresholdEtb: details?.thresholdEtb ?? kyc?.thresholdEtb ?? 0,
            });
            return;
          }
          case ErrorCode.DESTINATION_NOT_VERIFIED:
          case ErrorCode.DESTINATION_OTP_REQUIRED:
            dispatch({ type: 'verification_expired' });
            setStep('destination');
            return;
          case ErrorCode.INVALID_PAYOUT_DESTINATION:
            dispatch({ type: 'reset' });
            setStep('destination');
            break;
          case ErrorCode.BELOW_MIN_WITHDRAWAL:
          case ErrorCode.INSUFFICIENT_BALANCE:
            setStep('amount');
            setTouched(true);
            break;
          case ErrorCode.IDEMPOTENCY_KEY_REUSED:
            // Different payload under an old key: start a fresh intent for the next tap.
            intentKeys.current.reset();
            break;
          default:
            break;
        }
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
        return <Button title={t('common.continue')} disabled={!verified} onPress={() => setStep('confirm')} size="lg" testID="withdraw-destination-next" />;
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
          {kyc && kyc.tier === 'phone_only' ? (
            <Card tone={kyc.exceeds ? 'accent' : 'surface'} padding={spacing.md} testID="withdraw-kyc-progress">
              <View style={styles.noticeRow}>
                <Icon name="shield" size={18} color={kyc.exceeds ? colors.accentSoftText : colors.primary} />
                <View style={{ flex: 1, gap: 6 }}>
                  <Text variant="bodySmall" weight="semibold">
                    {t('wallet.kyc.monthlyTitle')}
                  </Text>
                  <Text variant="caption" tone="secondary">
                    {t('wallet.kyc.monthlyProgress', { used: formatEtb(kyc.monthlyEtb, t, language), limit: formatEtb(kyc.thresholdEtb, t, language) })}
                  </Text>
                  <ProgressBar progress={kyc.progress} color={kyc.exceeds ? colors.accent : undefined} />
                  {kyc.exceeds ? (
                    <Text variant="caption" style={{ color: colors.accentSoftText }} testID="withdraw-kyc-warning">
                      {t('wallet.kyc.wouldExceed', { projected: formatEtb(kyc.projectedEtb, t, language), limit: formatEtb(kyc.thresholdEtb, t, language) })}
                    </Text>
                  ) : null}
                </View>
              </View>
              {kyc.exceeds ? (
                <Button title={t('wallet.kyc.verifyCta')} onPress={() => router.push('/kyc')} size="sm" variant="secondary" icon="shield" style={{ marginTop: spacing.md }} testID="withdraw-kyc-cta" />
              ) : null}
            </Card>
          ) : null}
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
                onPress={() => chooseMethod(m)}
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
        <DestinationStep
          method={method}
          config={cfg}
          state={destination}
          dispatch={dispatch}
          remembered={remembered}
          destinationName={destinationName}
          onDestinationNameChange={setDestinationName}
          bankCode={bankCode}
          onBankCodeChange={setBankCode}
        />
      ) : null}

      {step === 'confirm' && method && validation?.ok && verified ? (
        <Animated.View entering={FadeIn} style={{ gap: spacing.lg }}>
          <Text variant="h3" weight="semibold">
            {t('withdraw.confirmTitle')}
          </Text>
          <Card>
            <SummaryRow label={t('withdraw.summaryAmount')} value={formatEtb(validation.amountEtb, t, language)} strong />
            <SummaryRow label={t('withdraw.summaryCoins')} value={t('money.coins', { count: validation.coins })} />
            <SummaryRow label={t('withdraw.summaryMethod')} value={method.label} />
            {verified.accountName ? <SummaryRow label={t('withdraw.summaryAccountName')} value={verified.accountName} /> : null}
            <SummaryRow label={t('withdraw.summaryDestination')} value={verified.payoutDestination} last={!destinationName.trim()} />
            {destinationName.trim() ? <SummaryRow label={t('withdraw.destinationName')} value={destinationName.trim()} last /> : null}
          </Card>
          <View style={styles.chips}>
            <Badge label={t('withdraw.verify.verified')} tone="success" icon="circleCheck" />
            {verified.resolution?.mock ? <Badge label={t('withdraw.verify.mock')} tone="warning" /> : null}
          </View>
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

      <KycRequiredSheet
        gate={kycGate}
        onClose={() => setKycGate(null)}
        onVerify={() => {
          setKycGate(null);
          router.push('/kyc');
        }}
      />
    </Screen>
  );
}

/** 422 KYC_REQUIRED: explains the rolling monthly limit for phone-only accounts and opens the KYC flow. */
function KycRequiredSheet({ gate, onClose, onVerify }: { gate: KycGate | null; onClose(): void; onVerify(): void }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const { colors, radii, spacing, shadows } = useTheme();
  if (!gate) return null;
  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View entering={FadeIn.duration(150)} style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.close')} />
        <Animated.View
          entering={FadeInUp.duration(220)}
          style={[styles.sheet, shadows.lg, { backgroundColor: colors.surfaceElevated, borderRadius: radii.xl, padding: spacing.xxl }]}
          accessibilityViewIsModal
          testID="withdraw-kyc-sheet"
        >
          <View style={[styles.sheetIcon, { backgroundColor: colors.primarySoft, borderRadius: radii.full }]}>
            <Icon name="shield" size={26} color={colors.primary} />
          </View>
          <Text variant="h2" weight="bold" accessibilityRole="header" style={{ marginTop: spacing.md }}>
            {t('wallet.kyc.requiredTitle')}
          </Text>
          <Text variant="body" tone="secondary" style={{ marginTop: spacing.sm }}>
            {t('wallet.kyc.requiredBody', {
              projected: formatEtb(gate.projectedEtb, t, language),
              limit: formatEtb(gate.thresholdEtb, t, language),
            })}
          </Text>
          <Card tone="muted" padding={spacing.md} style={{ marginTop: spacing.lg }}>
            <SummaryRow label={t('wallet.kyc.projected')} value={formatEtb(gate.projectedEtb, t, language)} />
            <SummaryRow label={t('wallet.kyc.limit')} value={formatEtb(gate.thresholdEtb, t, language)} last />
          </Card>
          <View style={{ marginTop: spacing.xl, gap: spacing.sm }}>
            <Button title={t('wallet.kyc.verifyCta')} onPress={onVerify} icon="shield" testID="withdraw-kyc-sheet-cta" />
            <Button title={t('common.close')} onPress={onClose} variant="ghost" />
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
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
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  sheet: { width: '100%', maxWidth: 420 },
  sheetIcon: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
});
