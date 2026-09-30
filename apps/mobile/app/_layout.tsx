import { QueryClientProvider } from '@tanstack/react-query';
import { Stack, usePathname, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { I18nextProvider } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { queryClient } from '@/api/queryClient';
import { selectProfileComplete, useAuthStore } from '@/auth/authStore';
import { hydrateAuth } from '@/auth/session';
import { ToastHost } from '@/components/ui/Toast';
import { i18n } from '@/i18n';
import { useNotificationDeepLinks } from '@/notifications/useNotificationDeepLinks';
import { usePrefsStore } from '@/stores/prefsStore';
import { useAppFonts } from '@/theme/fonts';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

/**
 * Global consent gate: whenever the API answers 403 CONSENT_REQUIRED (`consentPrompt` bumps) the user is
 * sent to the consent screen on top of the current stack; accepting pops back to where they were.
 */
function useConsentGate(enabled: boolean) {
  const router = useRouter();
  const pathname = usePathname();
  const consentPrompt = useAuthStore((s) => s.consentPrompt);
  const handled = useRef(0);
  useEffect(() => {
    if (!enabled || consentPrompt === 0 || handled.current === consentPrompt) return;
    handled.current = consentPrompt;
    if (pathname !== '/consent') router.push('/consent');
  }, [consentPrompt, enabled, pathname, router]);
}

function RootNavigator() {
  const { colors, isDark } = useTheme();
  const status = useAuthStore((s) => s.status);
  const blocked = useAuthStore((s) => s.blocked);
  const profileComplete = useAuthStore(selectProfileComplete);
  useNotificationDeepLinks();

  const signedIn = status === 'signedIn';
  const canUseApp = signedIn && !blocked && profileComplete;
  useConsentGate(canUseApp);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Protected guard={blocked !== null}>
          <Stack.Screen name="blocked" options={{ animation: 'fade' }} />
        </Stack.Protected>
        <Stack.Protected guard={status === 'signedOut' && blocked === null}>
          <Stack.Screen name="(onboarding)" options={{ animation: 'fade' }} />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && !blocked && !profileComplete}>
          <Stack.Screen name="complete-profile" options={{ animation: 'fade' }} />
        </Stack.Protected>
        <Stack.Protected guard={canUseApp}>
          <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
          <Stack.Screen name="consent" options={{ animation: 'fade', gestureEnabled: false }} />
          <Stack.Screen name="ad/[id]" options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
          <Stack.Screen name="ad/result" options={{ animation: 'fade', gestureEnabled: false }} />
          <Stack.Screen name="offers/survey/[id]" />
          <Stack.Screen name="offers/app-install/[id]" />
          <Stack.Screen name="wallet/withdraw" />
          <Stack.Screen name="wallet/withdrawals/index" />
          <Stack.Screen name="wallet/withdrawals/[id]" />
          <Stack.Screen name="notifications" />
          <Stack.Screen name="kyc/index" />
          <Stack.Screen name="kyc/submit" />
          <Stack.Screen name="referrals" />
          <Stack.Screen name="legal/index" />
          <Stack.Screen name="privacy/index" />
          <Stack.Screen name="settings/language" />
          <Stack.Screen name="settings/appearance" />
          <Stack.Screen name="settings/notifications" />
          <Stack.Screen name="settings/about" />
          <Stack.Screen name="settings/support" />
          <Stack.Screen name="settings/edit-name" />
          <Stack.Screen name="report-ad" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        </Stack.Protected>
      </Stack>
      <ToastHost />
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useAppFonts();
  const prefsHydrated = usePrefsStore((s) => s.hydrated);
  const language = usePrefsStore((s) => s.language);
  const authStatus = useAuthStore((s) => s.status);
  const authStarted = useRef(false);

  useEffect(() => {
    if (!authStarted.current) {
      authStarted.current = true;
      void hydrateAuth();
    }
  }, []);

  useEffect(() => {
    if (prefsHydrated && i18n.language !== language) void i18n.changeLanguage(language);
  }, [language, prefsHydrated]);

  const ready = (fontsLoaded || Boolean(fontError)) && prefsHydrated && authStatus !== 'hydrating';

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <I18nextProvider i18n={i18n}>
          <QueryClientProvider client={queryClient}>
            <ThemeProvider>
              <RootNavigator />
            </ThemeProvider>
          </QueryClientProvider>
        </I18nextProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
