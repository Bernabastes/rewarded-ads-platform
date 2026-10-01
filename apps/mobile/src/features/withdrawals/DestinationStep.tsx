import type { PayoutMethod, WithdrawalConfig, WithdrawalMethodInfo } from '@rap/shared';
import { ErrorCode } from '@rap/shared';
import { useEffect, useState, type Dispatch } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { withdrawalsApi } from '@/api/endpoints/withdrawals';
import { isApiError } from '@/api/errors';
import { Badge, Chip } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { OtpInput } from '@/components/ui/OtpInput';
import { Text } from '@/components/ui/Text';
import { useCountdown } from '@/components/ui/useCountdown';
import { IS_DEV } from '@/config';
import { useTheme } from '@/theme/ThemeProvider';
import { errorMessage } from '@/utils/errorMessage';
import { formatClock } from '@/utils/format';

import {
  isBusy,
  resolutionSecondsLeft,
  type DestinationEvent,
  type DestinationFlowState,
  type RememberedDestination,
} from './destinationFlow';
import { knownChipsFor } from './rememberedDestinations';
import { methodRequiresName, normalizeDestination, validateDestination } from './validation';

export interface DestinationStepProps {
  method: WithdrawalMethodInfo;
  config: WithdrawalConfig;
  state: DestinationFlowState;
  dispatch: Dispatch<DestinationEvent>;
  remembered: RememberedDestination[];
  destinationName: string;
  onDestinationNameChange(value: string): void;
  bankCode: string;
  onBankCodeChange(value: string): void;
}

/**
 * Destination step of the withdrawal wizard. New destinations go through the partner lookup
 * (`resolve` → "Pay <name> on telebirr?") and, when the server asks for it, a destination_change OTP.
 * Known destinations are one tap when this device remembers the full number.
 */
export function DestinationStep({
  method,
  config,
  state,
  dispatch,
  remembered,
  destinationName,
  onDestinationNameChange,
  bankCode,
  onBankCodeChange,
}: DestinationStepProps) {
  const { t } = useTranslation();
  const { colors, spacing, radii } = useTheme();
  const [knownHint, setKnownHint] = useState<string | null>(null);

  const kind = method.destinationKind;
  const payoutMethod = method.method as PayoutMethod;
  const destinationValid = validateDestination(kind, state.input);
  const needsName = methodRequiresName(payoutMethod);
  const nameValid = !needsName || destinationName.trim().length >= 2;
  const bankValid = payoutMethod !== 'bank' || bankCode.trim().length > 0;
  const normalized = normalizeDestination(kind, state.input);
  const chips = knownChipsFor(config.knownDestinations ?? [], remembered, payoutMethod);
  const busy = isBusy(state);
  const phase = state.phase;

  const resolve = async () => {
    if (!destinationValid || !nameValid || !bankValid || busy) return;
    dispatch({ type: 'resolve_started' });
    try {
      const resolution = await withdrawalsApi.resolveDestination({
        payoutMethod,
        payoutDestination: normalized,
        bankCode: payoutMethod === 'bank' ? bankCode.trim() : undefined,
      });
      dispatch({ type: 'resolve_succeeded', resolution });
    } catch (error) {
      if (isApiError(error) && error.code === ErrorCode.DESTINATION_NOT_FOUND) dispatch({ type: 'resolve_not_found' });
      else dispatch({ type: 'resolve_failed', message: errorMessage(error, t) });
    }
  };

  const requestOtp = async () => {
    dispatch({ type: 'otp_requested' });
    try {
      const info = await withdrawalsApi.requestDestinationOtp();
      dispatch({
        type: 'otp_sent',
        otp: {
          phoneMasked: info.phoneNumber,
          expiresInSeconds: info.expiresInSeconds,
          resendAfterSeconds: info.resendAfterSeconds,
          devCode: info.devCode ?? null,
        },
      });
    } catch (error) {
      dispatch({ type: 'otp_send_failed', message: errorMessage(error, t) });
    }
  };

  const errorText = (() => {
    const err = state.error;
    if (!err) return null;
    switch (err.kind) {
      case 'not_found':
        return t('withdraw.verify.notFound', { method: method.label });
      case 'expired':
        return t('withdraw.verify.expired');
      case 'otp_invalid':
        return err.attemptsLeft !== null ? `${err.message} ${t('onboarding.otp.attemptsRemaining', { count: err.attemptsLeft })}` : err.message;
      default:
        return err.message;
    }
  })();

  return (
    <Animated.View entering={FadeIn} style={{ gap: spacing.lg }}>
      <Text variant="h3" weight="semibold">
        {t('withdraw.destinationTitle')}
      </Text>

      {chips.length > 0 && phase.phase === 'entry' ? (
        <View style={{ gap: spacing.sm }} testID="withdraw-known-destinations">
          <Text variant="label" weight="medium" tone="secondary">
            {t('withdraw.verify.knownTitle')}
          </Text>
          <View style={styles.chips}>
            {chips.map(({ server, remembered: full }) => (
              <Chip
                key={server.id}
                icon="circleCheck"
                label={server.accountName ? `${server.accountName} · ${server.destination}` : server.destination}
                accessibilityLabel={t('withdraw.verify.knownChipA11y', { name: server.accountName ?? server.destination })}
                onPress={() => {
                  setKnownHint(null);
                  // Phase 4C: a known chip is one tap - the server resolves the number from `payoutDestinationId`.
                  if (full) dispatch({ type: 'known_selected', item: full });
                  else dispatch({ type: 'known_id_selected', item: server });
                }}
              />
            ))}
          </View>
          <Text variant="caption" tone="muted">
            {t('withdraw.verify.knownBody')}
          </Text>
        </View>
      ) : null}

      {phase.phase === 'entry' || phase.phase === 'resolving' ? (
        <View style={{ gap: spacing.lg }}>
          <Input
            label={t(`withdraw.destination.${kind}`)}
            placeholder={method.destinationHint}
            value={state.input}
            onChangeText={(value) => {
              setKnownHint(null);
              dispatch({ type: 'input_changed', value });
            }}
            keyboardType={kind === 'phone' ? 'phone-pad' : 'number-pad'}
            inputMode={kind === 'phone' ? 'tel' : 'numeric'}
            autoFocus
            editable={!busy}
            helperText={knownHint ?? t('withdraw.verify.newHelper')}
            errorText={state.input.length > 0 && !destinationValid ? t('withdraw.destinationInvalid') : errorText}
            testID="withdraw-destination-input"
          />
          {needsName ? (
            <>
              <Input
                label={t('withdraw.destinationName')}
                value={destinationName}
                onChangeText={onDestinationNameChange}
                autoCapitalize="words"
                editable={!busy}
                errorText={destinationName.length > 0 && !nameValid ? t('withdraw.destinationNameRequired') : null}
                testID="withdraw-destination-name"
              />
              <Input
                label={t('withdraw.bankCode')}
                placeholder={t('withdraw.bankCodePlaceholder')}
                value={bankCode}
                onChangeText={onBankCodeChange}
                autoCapitalize="characters"
                editable={!busy}
                testID="withdraw-bank-code"
              />
            </>
          ) : null}
          <Button
            title={phase.phase === 'resolving' ? t('withdraw.verify.checking') : t('withdraw.verify.check')}
            onPress={() => void resolve()}
            loading={phase.phase === 'resolving'}
            disabled={!destinationValid || !nameValid || !bankValid}
            variant="secondary"
            icon="shield"
            testID="withdraw-resolve"
          />
        </View>
      ) : null}

      {phase.phase === 'resolved' || phase.phase === 'otp_requesting' ? (
        <ConfirmationCard
          accountName={phase.resolution.accountName}
          destination={phase.resolution.normalizedDestination}
          methodLabel={method.label}
          mock={phase.resolution.mock}
          validUntil={phase.resolution.validUntil}
          requesting={phase.phase === 'otp_requesting'}
          onConfirm={() => void requestOtp()}
          onReject={() => dispatch({ type: 'confirmation_cancelled' })}
          errorText={errorText}
        />
      ) : null}

      {phase.phase === 'otp' ? (
        <DestinationOtp
          phoneMasked={phase.otp.phoneMasked}
          resendAfter={phase.otp.resendAfterSeconds}
          devCode={phase.otp.devCode}
          verifying={phase.verifying}
          errorText={errorText}
          onResend={() => void requestOtp()}
          onVerify={async (code) => {
            dispatch({ type: 'otp_submitted' });
            try {
              const verified = await withdrawalsApi.verifyDestinationOtp({
                code,
                payoutMethod,
                payoutDestination: phase.resolution.normalizedDestination,
                bankCode: payoutMethod === 'bank' ? bankCode.trim() : undefined,
              });
              dispatch({ type: 'otp_verified', verified });
            } catch (error) {
              // Phase 5 (#11): the partner lookup runs after the code; "no such account" surfaces here now.
              if (isApiError(error) && error.code === ErrorCode.DESTINATION_NOT_FOUND) {
                dispatch({ type: 'resolve_not_found' });
                return;
              }
              dispatch({
                type: 'otp_failed',
                message: errorMessage(error, t),
                attemptsLeft: isApiError(error) ? error.attemptsRemaining : null,
              });
            }
          }}
          onChangeDestination={() => dispatch({ type: 'reset' })}
        />
      ) : null}

      {phase.phase === 'verified' ? (
        <Animated.View entering={FadeInDown} testID="withdraw-destination-verified">
          <Card tone="surface" style={{ borderColor: colors.success }}>
            <View style={styles.rowBetween}>
              <Badge label={t('withdraw.verify.verified')} tone="success" icon="circleCheck" size="md" />
              {phase.resolution?.mock ? <Badge label={t('withdraw.verify.mock')} tone="warning" /> : null}
            </View>
            <Text variant="h3" weight="bold" style={{ marginTop: spacing.md }} testID="withdraw-verified-name">
              {phase.accountName ?? phase.payoutDestination}
            </Text>
            <Text variant="bodySmall" tone="secondary">
              {method.label}
              {' · '}
              {phase.payoutDestination}
            </Text>
            <Text variant="caption" tone="muted" style={{ marginTop: spacing.sm }}>
              {t(`withdraw.verify.via.${phase.via}`)}
            </Text>
            <Button
              title={t('withdraw.verify.change')}
              onPress={() => dispatch({ type: 'reset' })}
              variant="ghost"
              size="sm"
              fullWidth={false}
              icon="edit"
              style={{ marginTop: spacing.sm }}
              testID="withdraw-destination-change"
            />
          </Card>
        </Animated.View>
      ) : null}

      <View style={[styles.hint, { backgroundColor: colors.surfaceMuted, borderRadius: radii.md, padding: spacing.md }]}>
        <Icon name="lock" size={16} color={colors.textSecondary} />
        <Text variant="caption" tone="secondary" style={{ flex: 1 }}>
          {t('withdraw.verify.whyBody', { minutes: config.destinationResolveTtlMinutes })}
        </Text>
      </View>
    </Animated.View>
  );
}

interface ConfirmationCardProps {
  /** null for a NEW destination: the partner is only asked after the OTP (security audit #11). */
  accountName: string | null;
  destination: string;
  methodLabel: string;
  mock: boolean;
  validUntil: string;
  requesting: boolean;
  onConfirm(): void;
  onReject(): void;
  errorText: string | null;
}

/** "Pay Abebe Tesfaye on telebirr?" with the lookup expiry and a MOCK badge in demo mode. */
function ConfirmationCard({ accountName, destination, methodLabel, mock, validUntil, requesting, onConfirm, onReject, errorText }: ConfirmationCardProps) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const [secondsLeft, setSecondsLeft] = useState(() => resolutionSecondsLeft({ validUntil }));
  useEffect(() => {
    const timer = setInterval(() => setSecondsLeft(resolutionSecondsLeft({ validUntil })), 1000);
    return () => clearInterval(timer);
  }, [validUntil]);
  const expired = secondsLeft <= 0;

  return (
    <Animated.View entering={FadeInDown} testID="withdraw-resolve-card">
      <Card tone="accent">
        <View style={styles.rowBetween}>
          <Text variant="label" weight="semibold" style={{ color: colors.accentSoftText }}>
            {t('withdraw.verify.confirmTitle')}
          </Text>
          {mock ? <Badge label={t('withdraw.verify.mock')} tone="warning" /> : null}
        </View>
        <Text variant="h2" weight="bold" style={{ marginTop: spacing.sm }} testID="withdraw-resolve-name">
          {accountName ? t('withdraw.verify.payTo', { name: accountName, method: methodLabel }) : t('withdraw.verify.payToPending', { method: methodLabel })}
        </Text>
        <Text variant="bodySmall" tone="secondary">
          {destination}
        </Text>
        {!accountName ? (
          <Text variant="caption" tone="muted" style={{ marginTop: spacing.xs }} testID="withdraw-resolve-pending-hint">
            {t('withdraw.verify.nameAfterOtp')}
          </Text>
        ) : null}
        <Text variant="caption" tone={expired ? 'danger' : 'muted'} style={{ marginTop: spacing.sm }} testID="withdraw-resolve-expiry">
          {expired ? t('withdraw.verify.lookupExpired') : t('withdraw.verify.validFor', { time: formatClock(secondsLeft) })}
        </Text>
        {errorText ? (
          <Text variant="bodySmall" tone="danger" style={{ marginTop: spacing.sm }} accessibilityLiveRegion="polite">
            {errorText}
          </Text>
        ) : null}
        <View style={[styles.actions, { marginTop: spacing.lg }]}>
          <Button
            title={t('withdraw.verify.confirmYes')}
            onPress={onConfirm}
            loading={requesting}
            disabled={expired}
            fullWidth={false}
            style={{ flex: 1 }}
            icon="send"
            testID="withdraw-resolve-confirm"
          />
          <Button title={t('withdraw.verify.confirmNo')} onPress={onReject} variant="ghost" fullWidth={false} testID="withdraw-resolve-reject" />
        </View>
      </Card>
    </Animated.View>
  );
}

interface DestinationOtpProps {
  phoneMasked: string;
  resendAfter: number;
  devCode: string | null;
  verifying: boolean;
  errorText: string | null;
  onVerify(code: string): void | Promise<void>;
  onResend(): void;
  onChangeDestination(): void;
}

function DestinationOtp({ phoneMasked, resendAfter, devCode, verifying, errorText, onVerify, onResend, onChangeDestination }: DestinationOtpProps) {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const [code, setCode] = useState('');
  const cooldown = useCountdown(resendAfter);
  useEffect(() => {
    if (errorText) setCode('');
  }, [errorText]);

  return (
    <Animated.View entering={FadeInDown} style={{ gap: spacing.md }} testID="withdraw-destination-otp">
      <Text variant="body" weight="semibold">
        {t('withdraw.verify.otpTitle')}
      </Text>
      <Text variant="bodySmall" tone="secondary">
        {t('withdraw.verify.otpBody', { phone: phoneMasked })}
      </Text>
      <OtpInput value={code} onChange={setCode} onComplete={(value) => void onVerify(value)} error={Boolean(errorText)} disabled={verifying} testID="destination-otp" />
      {errorText ? (
        <Text variant="bodySmall" tone="danger" accessibilityLiveRegion="polite" testID="destination-otp-error">
          {errorText}
        </Text>
      ) : null}
      {IS_DEV && devCode ? (
        <View style={{ gap: 6 }}>
          <Badge label={t('common.developmentOnly')} tone="warning" icon="alert" />
          <Text variant="bodySmall" tone="secondary" testID="destination-otp-dev-hint">
            {t('onboarding.otp.devHint', { code: devCode })}
          </Text>
        </View>
      ) : null}
      <View style={styles.actions}>
        <Button
          title={cooldown.active ? t('onboarding.otp.resendIn', { seconds: cooldown.seconds }) : t('onboarding.otp.resend')}
          onPress={() => {
            cooldown.restart(resendAfter);
            onResend();
          }}
          variant="ghost"
          size="sm"
          fullWidth={false}
          disabled={cooldown.active || verifying}
          testID="destination-otp-resend"
        />
        <Button title={t('withdraw.verify.change')} onPress={onChangeDestination} variant="ghost" size="sm" fullWidth={false} icon="edit" />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  hint: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
});
