import { useRouter } from 'expo-router';
import type { PropsWithChildren, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/ThemeProvider';

import { Icon } from './Icon';
import { Tappable } from './Tappable';
import { Text } from './Text';

export interface ScreenHeaderProps {
  title?: string;
  subtitle?: string;
  onBack?: () => void | boolean;
  hideBack?: boolean;
  right?: ReactNode;
  /** Render the title large below the nav row (onboarding style) instead of inline. */
  large?: boolean;
}

export function ScreenHeader({ title, subtitle, onBack, hideBack, right, large }: ScreenHeaderProps) {
  const { colors, spacing, minTouchTarget } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const canGoBack = !hideBack && (onBack || router.canGoBack());

  const handleBack = () => {
    if (onBack) {
      const handled = onBack();
      if (handled === true) return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <View style={{ paddingHorizontal: spacing.lg, paddingBottom: large ? spacing.md : 0 }}>
      <View style={[styles.navRow, { minHeight: minTouchTarget + 8 }]}>
        <View style={styles.navSide}>
          {canGoBack ? (
            <Tappable
              onPress={handleBack}
              accessibilityRole="button"
              accessibilityLabel={t('a11y.back')}
              hitSlop={8}
              style={[styles.iconButton, { width: minTouchTarget, height: minTouchTarget }]}
            >
              <Icon name="arrowLeft" color={colors.text} />
            </Tappable>
          ) : null}
        </View>
        {!large && title ? (
          <Text variant="h3" weight="semibold" numberOfLines={1} style={styles.inlineTitle} accessibilityRole="header">
            {title}
          </Text>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <View style={[styles.navSide, { alignItems: 'flex-end' }]}>{right}</View>
      </View>
      {large && title ? (
        <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>
          <Text variant="h1" weight="bold" accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? (
            <Text variant="body" tone="secondary">
              {subtitle}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export interface ScreenProps extends PropsWithChildren {
  header?: ScreenHeaderProps | null;
  scroll?: boolean;
  padded?: boolean;
  edges?: Edge[];
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  refreshing?: boolean;
  onRefresh?: () => void;
  footer?: ReactNode;
  scrollProps?: Omit<ScrollViewProps, 'children'>;
  keyboardAvoiding?: boolean;
  /** Optional background override (e.g. primary for the result screen). */
  backgroundColor?: string;
  testID?: string;
}

/** Page container handling safe areas, background, optional header, scrolling and pull-to-refresh. */
export function Screen({
  children,
  header,
  scroll = true,
  padded = true,
  edges = ['top', 'left', 'right'],
  style,
  contentStyle,
  refreshing,
  onRefresh,
  footer,
  scrollProps,
  keyboardAvoiding = false,
  backgroundColor,
  testID,
}: ScreenProps) {
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  const padding: ViewStyle = {
    paddingTop: edges.includes('top') ? insets.top : 0,
    paddingLeft: edges.includes('left') ? insets.left : 0,
    paddingRight: edges.includes('right') ? insets.right : 0,
    paddingBottom: edges.includes('bottom') ? insets.bottom : 0,
  };

  const bodyPadding: ViewStyle = padded
    ? { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxxl }
    : {};

  // The ScrollView itself must be clamped to the remaining viewport height (flex: 1); only its
  // content container grows, so short pages still push footers down while long pages can scroll.
  // On react-native-web a bare flexGrow: 1 sizes the container to its content and nothing scrolls.
  const { style: scrollStyle, ...restScrollProps } = scrollProps ?? {};
  const body = scroll ? (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      style={[styles.flex, scrollStyle]}
      contentContainerStyle={[styles.grow, bodyPadding, contentStyle]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={Boolean(refreshing)}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
            accessibilityLabel={t('a11y.refreshing')}
          />
        ) : undefined
      }
      {...restScrollProps}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, bodyPadding, contentStyle]}>{children}</View>
  );

  const content = (
    <>
      {header ? <ScreenHeader {...header} /> : null}
      {body}
      {footer ? (
        <View
          style={{
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.sm,
            paddingBottom: Math.max(insets.bottom, spacing.lg),
          }}
        >
          {footer}
        </View>
      ) : null}
    </>
  );

  return (
    <View style={[styles.flex, { backgroundColor: backgroundColor ?? colors.background }, padding, style]} testID={testID}>
      {keyboardAvoiding ? (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {content}
        </KeyboardAvoidingView>
      ) : (
        content
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  /** Fill the parent and allow shrinking (flexGrow 1 / flexShrink 1 / flexBasis 0) so overflow can scroll. */
  flex: { flex: 1, minHeight: 0 },
  /** Content-container only: grow to fill, but never constrain height. */
  grow: { flexGrow: 1 },
  navRow: { flexDirection: 'row', alignItems: 'center' },
  navSide: { width: 56, justifyContent: 'center' },
  iconButton: { alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  inlineTitle: { flex: 1, textAlign: 'center' },
});
