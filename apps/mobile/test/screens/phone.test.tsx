import { ErrorCode } from '@rap/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import PhoneScreen from '../../app/(onboarding)/phone';
import { authApi } from '@/api/endpoints/auth';
import { ApiError } from '@/api/errors';
import { renderWithProviders, useTestLanguage } from '../render';

jest.mock('@/api/endpoints/auth', () => ({ authApi: { requestOtp: jest.fn() } }));

const requestOtp = authApi.requestOtp as jest.Mock;

describe('Phone screen - OTP rate limit (F6)', () => {
  afterEach(async () => {
    jest.useRealTimers();
    await useTestLanguage('am');
  });

  it('locks the button with a live countdown on 429 OTP_RATE_LIMITED and re-enables it at zero', async () => {
    await useTestLanguage('en');
    requestOtp.mockRejectedValueOnce(new ApiError(429, ErrorCode.OTP_RATE_LIMITED, 'wait', { retryAfterSeconds: 3 }));
    await renderWithProviders(<PhoneScreen />);

    await fireEvent.changeText(screen.getByTestId('phone-input'), '977100004');
    await fireEvent.press(screen.getByTestId('phone-submit'));

    await waitFor(() => expect(screen.getByTestId('phone-rate-limited')).toBeTruthy());
    expect(screen.getByText('Try again in 3s')).toBeTruthy();
    expect(screen.getByTestId('phone-submit').props.accessibilityState.disabled).toBe(true);

    // The countdown ticks once a second and unlocks the button when it reaches zero.
    await waitFor(() => expect(screen.getByText('Try again in 2s')).toBeTruthy(), { timeout: 2500 });
    await waitFor(() => expect(screen.queryByTestId('phone-rate-limited')).toBeNull(), { timeout: 4000 });
    expect(screen.getByText('Send code')).toBeTruthy();
    expect(screen.getByTestId('phone-submit').props.accessibilityState.disabled).toBe(false);
  }, 15_000);

  it('passes an optional referral code along to the OTP screen', async () => {
    await useTestLanguage('en');
    requestOtp.mockResolvedValueOnce({ phoneNumber: '+251977100005', expiresInSeconds: 300, resendAfterSeconds: 60, devCode: '123456' });
    const { router } = jest.requireMock('expo-router') as { router: { push: jest.Mock } };
    router.push.mockClear();
    await renderWithProviders(<PhoneScreen />);

    await fireEvent.press(screen.getByTestId('phone-referral-toggle'));
    await fireEvent.changeText(screen.getByTestId('phone-referral-input'), '779hlb');
    await fireEvent.changeText(screen.getByTestId('phone-input'), '977100005');
    await fireEvent.press(screen.getByTestId('phone-submit'));

    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect(router.push).toHaveBeenLastCalledWith(
      expect.objectContaining({
        pathname: '/(onboarding)/otp',
        params: expect.objectContaining({ referralCode: '779HLB', phone: '+251977100005' }),
      }),
    );
  });
});
