import { Redirect } from 'expo-router';

import { selectProfileComplete, useAuthStore } from '@/auth/authStore';
import { usePrefsStore } from '@/stores/prefsStore';

/** Entry hub: sends the user to the right place for their session state. */
export default function Index() {
  const status = useAuthStore((s) => s.status);
  const blocked = useAuthStore((s) => s.blocked);
  const profileComplete = useAuthStore(selectProfileComplete);
  const hasSeenWelcome = usePrefsStore((s) => s.hasSeenWelcome);

  if (blocked) return <Redirect href="/blocked" />;
  if (status !== 'signedIn') {
    return <Redirect href={hasSeenWelcome ? '/(onboarding)/phone' : '/(onboarding)/welcome'} />;
  }
  if (!profileComplete) return <Redirect href="/complete-profile" />;
  return <Redirect href="/(tabs)" />;
}
