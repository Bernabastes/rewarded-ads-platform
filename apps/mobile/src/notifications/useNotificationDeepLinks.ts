import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { resolveNotificationTarget, loadNotifications } from './push';

/**
 * Routes the user when they tap a push notification (cold start or foreground).
 * No-op on web / Expo Go where the notifications module is unavailable.
 */
export function useNotificationDeepLinks() {
  const router = useRouter();
  useEffect(() => {
    const notifications = loadNotifications();
    if (!notifications) return;
    const navigate = (content: { data?: Record<string, unknown> | null }) => {
      const data = content.data ?? null;
      const type = typeof data?.type === 'string' ? data.type : undefined;
      const target = resolveNotificationTarget(type, data);
      router.push({ pathname: target.pathname, params: target.params } as never);
    };
    const subscription = notifications.addNotificationResponseReceivedListener((response) => {
      navigate(response.notification.request.content);
    });
    void notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) navigate(response.notification.request.content);
    });
    return () => subscription.remove();
  }, [router]);
}
