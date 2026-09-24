import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { resolveFontFamily } from '@/theme/fonts';
import { useTheme } from '@/theme/ThemeProvider';

import { Text } from './Text';

export interface OtpInputProps {
  length?: number;
  value: string;
  onChange(value: string): void;
  /** Fired once when the last digit is typed. */
  onComplete?(value: string): void;
  error?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  testID?: string;
}

/**
 * Six auto-advancing digit boxes driven by ONE hidden TextInput, which keeps keyboard handling,
 * paste and SMS autofill (`oneTimeCode`) working on every platform.
 */
export function OtpInput({
  length = 6,
  value,
  onChange,
  onComplete,
  error = false,
  disabled = false,
  autoFocus = true,
  testID = 'otp-input',
}: OtpInputProps) {
  const { colors, radii } = useTheme();
  const { t, i18n } = useTranslation();
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const completedFor = useRef<string | null>(null);

  useEffect(() => {
    if (value.length === length && completedFor.current !== value) {
      completedFor.current = value;
      onComplete?.(value);
    }
    if (value.length < length) completedFor.current = null;
  }, [value, length, onComplete]);

  const handleChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, length);
    onChange(digits);
  };

  const digits = Array.from({ length }, (_, i) => value[i] ?? '');
  const activeIndex = Math.min(value.length, length - 1);

  return (
    <Pressable
      onPress={() => inputRef.current?.focus()}
      accessibilityRole="none"
      style={styles.wrapper}
      disabled={disabled}
      testID={testID}
    >
      <View style={styles.row} accessible={false}>
        {digits.map((digit, index) => {
          const isActive = focused && index === activeIndex;
          return (
            <View
              key={index}
              accessibilityLabel={t('a11y.otpDigit', { index: index + 1, total: length })}
              accessibilityValue={{ text: digit || undefined }}
              style={[
                styles.box,
                {
                  borderRadius: radii.md,
                  backgroundColor: colors.surface,
                  borderColor: error ? colors.danger : isActive ? colors.primary : colors.border,
                  borderWidth: isActive || error ? 2 : 1.5,
                },
              ]}
            >
              <Text variant="h2" weight="semibold" style={{ fontFamily: resolveFontFamily('semibold', i18n.language) }}>
                {digit}
              </Text>
              {isActive && !digit ? <View style={[styles.caret, { backgroundColor: colors.primary }]} /> : null}
            </View>
          );
        })}
      </View>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={handleChange}
        keyboardType="number-pad"
        inputMode="numeric"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={length}
        autoFocus={autoFocus}
        editable={!disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        caretHidden
        accessibilityLabel={t('onboarding.otp.title')}
        style={styles.hidden}
        testID={`${testID}-field`}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  box: { flex: 1, aspectRatio: 0.85, maxWidth: 56, alignItems: 'center', justifyContent: 'center' },
  caret: { position: 'absolute', width: 2, height: 24, borderRadius: 1 },
  hidden: { position: 'absolute', opacity: 0, height: 1, width: 1, left: 0, top: 0 },
});
