import { forwardRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';

import { resolveFontFamily } from '@/theme/fonts';
import { useTheme } from '@/theme/ThemeProvider';

import { Text } from './Text';

export interface InputProps extends TextInputProps {
  label?: string;
  helperText?: string;
  errorText?: string | null;
  containerStyle?: StyleProp<ViewStyle>;
  /** Fixed content rendered before the input (e.g. "+251"). */
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
}

export const Input = forwardRef<TextInput, InputProps>(function Input(
  { label, helperText, errorText, containerStyle, prefix, suffix, style, onFocus, onBlur, editable = true, ...rest },
  ref,
) {
  const { colors, radii, spacing } = useTheme();
  const { i18n } = useTranslation();
  const [focused, setFocused] = useState(false);
  const borderColor = errorText ? colors.danger : focused ? colors.primary : colors.border;

  return (
    <View style={containerStyle}>
      {label ? (
        <Text variant="label" weight="medium" tone="secondary" style={{ marginBottom: spacing.xs }}>
          {label}
        </Text>
      ) : null}
      <View
        style={[
          styles.field,
          {
            borderColor,
            borderRadius: radii.md,
            backgroundColor: editable ? colors.surface : colors.surfaceMuted,
            paddingHorizontal: spacing.lg,
          },
        ]}
      >
        {prefix ? <View style={{ marginRight: spacing.sm }}>{prefix}</View> : null}
        <TextInput
          ref={ref}
          style={[
            styles.input,
            { color: colors.text, fontFamily: resolveFontFamily('regular', i18n.language, rest.value) },
            style,
          ]}
          placeholderTextColor={colors.textMuted}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          editable={editable}
          accessibilityLabel={rest.accessibilityLabel ?? label}
          {...rest}
        />
        {suffix ? <View style={{ marginLeft: spacing.sm }}>{suffix}</View> : null}
      </View>
      {errorText ? (
        <Text variant="caption" tone="danger" style={{ marginTop: spacing.xs }} accessibilityLiveRegion="polite">
          {errorText}
        </Text>
      ) : helperText ? (
        <Text variant="caption" tone="muted" style={{ marginTop: spacing.xs }}>
          {helperText}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, minHeight: 52 },
  input: { flex: 1, fontSize: 16, paddingVertical: 12, minHeight: 48 },
});
