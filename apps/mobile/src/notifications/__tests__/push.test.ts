import { registerPushToken, resolveNotificationTarget } from '../push';

describe('registerPushToken', () => {
  it('no-ops when the notifications module is unavailable (web / Expo Go)', async () => {
    const register = jest.fn();
    await expect(registerPushToken('dev', { notifications: null, register })).resolves.toBe(false);
    expect(register).not.toHaveBeenCalled();
  });

  it('no-ops without an EAS project id', async () => {
    const register = jest.fn();
    const notifications = { getPermissionsAsync: jest.fn() } as never;
    await expect(registerPushToken('dev', { notifications, projectId: null, platform: 'android', register })).resolves.toBe(false);
    expect(register).not.toHaveBeenCalled();
  });

  it('registers the token when permission is granted', async () => {
    const register = jest.fn(async () => ({}));
    const notifications = {
      getPermissionsAsync: jest.fn(async () => ({ status: 'undetermined' })),
      requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
      setNotificationChannelAsync: jest.fn(async () => undefined),
      getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[abc]' })),
      AndroidImportance: { DEFAULT: 3 },
    } as never;
    await expect(registerPushToken('device-1', { notifications, projectId: 'proj', platform: 'android', register })).resolves.toBe(true);
    expect(register).toHaveBeenCalledWith({ token: 'ExponentPushToken[abc]', platform: 'android', deviceId: 'device-1' });
  });

  it('swallows failures from the notifications module', async () => {
    const register = jest.fn();
    const notifications = {
      getPermissionsAsync: jest.fn(async () => {
        throw new Error('boom');
      }),
    } as never;
    await expect(registerPushToken('d', { notifications, projectId: 'proj', platform: 'ios', register })).resolves.toBe(false);
  });
});

describe('resolveNotificationTarget', () => {
  it('deep links withdrawal updates to the withdrawal detail', () => {
    expect(resolveNotificationTarget('withdrawal_status', { withdrawalId: 'w1' })).toEqual({
      pathname: '/wallet/withdrawals/[id]',
      params: { id: 'w1' },
    });
    expect(resolveNotificationTarget('withdrawal_status', null)).toEqual({ pathname: '/wallet/withdrawals' });
  });

  it('routes rewards to the wallet and offers to the offer', () => {
    expect(resolveNotificationTarget('reward_confirmed', null).pathname).toBe('/(tabs)/wallet');
    expect(resolveNotificationTarget('new_offer', { offerId: 's1', offerType: 'survey' })).toEqual({
      pathname: '/offers/survey/[id]',
      params: { id: 's1' },
    });
    expect(resolveNotificationTarget('new_offer', null).pathname).toBe('/(tabs)/offers');
    expect(resolveNotificationTarget('system', null).pathname).toBe('/notifications');
  });

  it('deep links the Phase 4 notification types to their screens', () => {
    expect(resolveNotificationTarget('kyc_status', { submissionId: 'k1' }).pathname).toBe('/kyc');
    expect(resolveNotificationTarget('referral', null).pathname).toBe('/referrals');
    expect(resolveNotificationTarget('data_export', { exportId: 'e1' }).pathname).toBe('/privacy');
    expect(resolveNotificationTarget('account_deletion', null).pathname).toBe('/privacy');
  });
});
