import type { DevicePlatform } from '@rap/shared';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import type * as ExpoNotifications from 'expo-notifications';
import { Platform } from 'react-native';

import { usersApi } from '@/api/endpoints/users';
import { EAS_PROJECT_ID } from '@/config';

type NotificationsModule = typeof ExpoNotifications;

let cachedModule: NotificationsModule | null | undefined;

/** Loads expo-notifications lazily and only where push can work (never on web, never in Jest). */
export function loadNotifications(): NotificationsModule | null {
  if (cachedModule !== undefined) return cachedModule;
  if (Platform.OS === 'web' || !Device.isDevice) {
    cachedModule = null;
    return null;
  }
  try {
    cachedModule = require('expo-notifications') as NotificationsModule;
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

export function resolveProjectId(): string | null {
  if (EAS_PROJECT_ID) return EAS_PROJECT_ID;
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId || null;
}

export interface PushDeps {
  notifications?: NotificationsModule | null;
  projectId?: string | null;
  platform?: DevicePlatform | 'other';
  register?: (dto: { token: string; platform: DevicePlatform; deviceId?: string }) => Promise<unknown>;
}

/**
 * Registers the Expo push token with the API. Every failure is swallowed: the app must keep
 * working on web, in Expo Go (no remote push since SDK 53) and on simulators.
 * Returns true when a token was registered.
 */
export async function registerPushToken(deviceId?: string, deps: PushDeps = {}): Promise<boolean> {
  const notifications = deps.notifications === undefined ? loadNotifications() : deps.notifications;
  const platform = deps.platform ?? (Platform.OS as DevicePlatform | 'other');
  if (!notifications || (platform !== 'android' && platform !== 'ios')) return false;
  const projectId = deps.projectId === undefined ? resolveProjectId() : deps.projectId;
  if (!projectId) return false;

  try {
    const existing = await notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      status = (await notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return false;

    if (platform === 'android') {
      await notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: notifications.AndroidImportance.DEFAULT,
      });
    }
    const { data: token } = await notifications.getExpoPushTokenAsync({ projectId });
    if (!token) return false;
    await (deps.register ?? usersApi.registerPushToken)({ token, platform, deviceId });
    return true;
  } catch {
    return false;
  }
}

export interface NotificationTarget {
  pathname: string;
  params?: Record<string, string>;
}

/** Maps a notification payload (`type` + `data`) to an in-app destination. */
export function resolveNotificationTarget(type: string | undefined, data: Record<string, unknown> | null | undefined) {
  const withdrawalId = typeof data?.withdrawalId === 'string' ? data.withdrawalId : null;
  const offerId = typeof data?.offerId === 'string' ? data.offerId : null;
  const offerType = typeof data?.offerType === 'string' ? data.offerType : null;
  switch (type) {
    case 'withdrawal_status':
      return withdrawalId
        ? { pathname: '/wallet/withdrawals/[id]', params: { id: withdrawalId } }
        : { pathname: '/wallet/withdrawals' };
    case 'reward_confirmed':
    case 'reward_flagged':
      return { pathname: '/(tabs)/wallet' };
    case 'new_offer':
      if (offerId && offerType === 'survey') return { pathname: '/offers/survey/[id]', params: { id: offerId } };
      if (offerId && offerType === 'app_install')
        return { pathname: '/offers/app-install/[id]', params: { id: offerId } };
      return { pathname: '/(tabs)/offers' };
    case 'account_status':
      return { pathname: '/(tabs)/profile' };
    default:
      return { pathname: '/notifications' };
  }
}
