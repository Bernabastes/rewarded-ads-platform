import type { PayoutDestinationItem, ResolveDestinationResponse } from '@rap/shared';

import {
  destinationReducer,
  initialDestinationState,
  isBusy,
  isResolutionExpired,
  isVerified,
  matchesMask,
  resolutionSecondsLeft,
  type DestinationFlowState,
} from '../destinationFlow';
import { knownChipsFor } from '../rememberedDestinations';

const resolution = (overrides: Partial<ResolveDestinationResponse> = {}): ResolveDestinationResponse => ({
  accountName: 'Fikru Desta',
  normalizedDestination: '+251977200002',
  payoutMethod: 'telebirr',
  provider: 'telebirr',
  mock: true,
  known: false,
  otpRequired: true,
  validUntil: '2026-09-29T14:41:41.229Z',
  ...overrides,
});

const otp = { phoneMasked: '+2519****0001', expiresInSeconds: 300, resendAfterSeconds: 60, devCode: '927841' };

const run = (events: Parameters<typeof destinationReducer>[1][]): DestinationFlowState =>
  events.reduce(destinationReducer, initialDestinationState);

describe('destination step state machine', () => {
  it('goes entry → resolving → resolved → otp → verified for a brand-new destination', () => {
    let state = run([{ type: 'input_changed', value: '0977200002' }, { type: 'resolve_started' }]);
    expect(state.phase.phase).toBe('resolving');
    expect(isBusy(state)).toBe(true);

    state = destinationReducer(state, { type: 'resolve_succeeded', resolution: resolution() });
    expect(state.phase.phase).toBe('resolved');
    expect(isVerified(state)).toBe(false);

    state = destinationReducer(state, { type: 'otp_requested' });
    expect(state.phase.phase).toBe('otp_requesting');
    state = destinationReducer(state, { type: 'otp_sent', otp });
    expect(state.phase).toMatchObject({ phase: 'otp', verifying: false });

    state = destinationReducer(state, { type: 'otp_submitted' });
    expect(isBusy(state)).toBe(true);
    state = destinationReducer(state, { type: 'otp_verified' });
    expect(isVerified(state)).toBe(true);
    expect(state.phase).toMatchObject({
      phase: 'verified',
      via: 'otp',
      payoutDestination: '+251977200002',
      accountName: 'Fikru Desta',
    });
  });

  it('skips the OTP when the partner already knows the destination', () => {
    const state = run([
      { type: 'input_changed', value: '0911000137' },
      { type: 'resolve_started' },
      { type: 'resolve_succeeded', resolution: resolution({ known: true, otpRequired: false, normalizedDestination: '+251911000137' }) },
    ]);
    expect(state.phase).toMatchObject({ phase: 'verified', via: 'known_server', payoutDestination: '+251911000137' });
  });

  it('a known chip verifies immediately with the remembered full number', () => {
    const state = run([
      { type: 'known_selected', item: { payoutMethod: 'telebirr', destination: '+251911000137', accountName: 'Tigist Haile', bankCode: null } },
    ]);
    expect(state.input).toBe('+251911000137');
    expect(state.phase).toMatchObject({ phase: 'verified', via: 'known_chip', accountName: 'Tigist Haile' });
  });

  it('surfaces DESTINATION_NOT_FOUND inline and returns to entry', () => {
    const state = run([{ type: 'input_changed', value: '0977200000' }, { type: 'resolve_started' }, { type: 'resolve_not_found' }]);
    expect(state.phase.phase).toBe('entry');
    expect(state.error).toEqual({ kind: 'not_found' });
    // Typing again clears the error.
    expect(destinationReducer(state, { type: 'input_changed', value: '0977200001' }).error).toBeNull();
  });

  it('keeps the OTP screen on a wrong code, with the attempts left, and clears the code state', () => {
    let state = run([
      { type: 'input_changed', value: '0977200002' },
      { type: 'resolve_started' },
      { type: 'resolve_succeeded', resolution: resolution() },
      { type: 'otp_requested' },
      { type: 'otp_sent', otp },
      { type: 'otp_submitted' },
      { type: 'otp_failed', message: 'That code is not correct.', attemptsLeft: 2 },
    ]);
    expect(state.phase).toMatchObject({ phase: 'otp', verifying: false });
    expect(state.error).toEqual({ kind: 'otp_invalid', message: 'That code is not correct.', attemptsLeft: 2 });
    state = destinationReducer(state, { type: 'otp_submitted' });
    expect(state.error).toBeNull();
  });

  it('falls back to the confirmation card when the OTP could not be sent', () => {
    const state = run([
      { type: 'input_changed', value: '0977200002' },
      { type: 'resolve_started' },
      { type: 'resolve_succeeded', resolution: resolution() },
      { type: 'otp_requested' },
      { type: 'otp_send_failed', message: 'offline' },
    ]);
    expect(state.phase.phase).toBe('resolved');
    expect(state.error).toEqual({ kind: 'generic', message: 'offline' });
  });

  it('handles cancellation, reset and a lookup that expired before POST /withdrawals', () => {
    const resolved = run([
      { type: 'input_changed', value: '0977200002' },
      { type: 'resolve_started' },
      { type: 'resolve_succeeded', resolution: resolution() },
    ]);
    expect(destinationReducer(resolved, { type: 'confirmation_cancelled' }).phase.phase).toBe('entry');
    expect(destinationReducer(resolved, { type: 'reset' })).toEqual(initialDestinationState);
    const expired = destinationReducer(
      destinationReducer(resolved, { type: 'resolve_succeeded', resolution: resolution({ otpRequired: false }) }),
      { type: 'verification_expired' },
    );
    expect(expired.phase.phase).toBe('entry');
    expect(expired.error).toEqual({ kind: 'expired' });
  });

  it('ignores OTP events outside the OTP phase', () => {
    const entry = run([{ type: 'input_changed', value: '0977200002' }]);
    expect(destinationReducer(entry, { type: 'otp_verified' })).toBe(entry);
    expect(destinationReducer(entry, { type: 'otp_requested' })).toBe(entry);
  });

  it('knows when a lookup has expired', () => {
    const now = new Date('2026-09-29T14:40:00.000Z');
    expect(isResolutionExpired(resolution(), now)).toBe(false);
    expect(resolutionSecondsLeft(resolution(), now)).toBe(102);
    expect(isResolutionExpired(resolution(), new Date('2026-09-29T14:41:41.229Z'))).toBe(true);
    expect(resolutionSecondsLeft(resolution(), new Date('2026-09-29T15:00:00Z'))).toBe(0);
    expect(isResolutionExpired(null, now)).toBe(false);
  });
});

describe('known destination chips', () => {
  const known: PayoutDestinationItem[] = [
    {
      id: 'd1',
      payoutMethod: 'telebirr',
      destination: '+2519****0137',
      bankCode: null,
      accountName: 'Tigist Haile',
      verifiedAt: '2026-09-19T10:49:02.957Z',
      otpVerifiedAt: '2026-09-19T10:50:02.957Z',
      lastUsedAt: '2026-09-25T18:50:19.264Z',
      useCount: 2,
      known: true,
    },
    { id: 'd2', payoutMethod: 'bank', destination: '1000****4321', bankCode: 'CBE', accountName: null, verifiedAt: null, otpVerifiedAt: null, lastUsedAt: null, useCount: 0, known: false },
  ];

  it('matches server masks against full numbers', () => {
    expect(matchesMask('+251911000137', '+2519****0137')).toBe(true);
    expect(matchesMask('+251911000138', '+2519****0137')).toBe(false);
    expect(matchesMask('0911000137', '+2519****0137')).toBe(false);
  });

  it('pairs masked known destinations with what the device remembers, per method', () => {
    const remembered = [{ payoutMethod: 'telebirr' as const, destination: '+251911000137', accountName: 'Tigist Haile', bankCode: null }];
    const chips = knownChipsFor(known, remembered, 'telebirr');
    expect(chips).toHaveLength(1);
    expect(chips[0].remembered?.destination).toBe('+251911000137');
    expect(knownChipsFor(known, [], 'telebirr')[0].remembered).toBeNull();
    // Not `known` on the server → no chip.
    expect(knownChipsFor(known, remembered, 'bank')).toHaveLength(0);
  });
});
