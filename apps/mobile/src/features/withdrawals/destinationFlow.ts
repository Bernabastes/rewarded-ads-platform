import type { PayoutMethod, ResolveDestinationResponse } from '@rap/shared';

/** A destination the user already paid out to from this device (full number, never masked). */
export interface RememberedDestination {
  payoutMethod: PayoutMethod;
  /** Normalised destination exactly as it was sent to `POST /withdrawals`. */
  destination: string;
  accountName: string | null;
  bankCode: string | null;
}

export interface DestinationOtpInfo {
  /** Masked phone the code was sent to (the user's own number). */
  phoneMasked: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
  devCode: string | null;
}

export type DestinationPhase =
  /** Typing / choosing a destination. */
  | { phase: 'entry' }
  /** `POST /withdrawals/destinations/resolve` in flight. */
  | { phase: 'resolving' }
  /** Partner returned an account name; the user must confirm before we send the OTP. */
  | { phase: 'resolved'; resolution: ResolveDestinationResponse }
  /** `otp/request` in flight. */
  | { phase: 'otp_requesting'; resolution: ResolveDestinationResponse }
  /** Waiting for the 6-digit destination_change code. */
  | { phase: 'otp'; resolution: ResolveDestinationResponse; otp: DestinationOtpInfo; verifying: boolean }
  /** Ready for `POST /withdrawals`. */
  | {
      phase: 'verified';
      via: 'known_chip' | 'known_server' | 'otp' | 'no_otp';
      payoutDestination: string;
      accountName: string | null;
      resolution: ResolveDestinationResponse | null;
    };

export type DestinationError =
  | { kind: 'not_found' }
  | { kind: 'expired' }
  | { kind: 'otp_invalid'; message: string; attemptsLeft: number | null }
  | { kind: 'generic'; message: string };

export interface DestinationFlowState {
  input: string;
  phase: DestinationPhase;
  error: DestinationError | null;
}

export const initialDestinationState: DestinationFlowState = { input: '', phase: { phase: 'entry' }, error: null };

export type DestinationEvent =
  | { type: 'input_changed'; value: string }
  | { type: 'known_selected'; item: RememberedDestination }
  | { type: 'reset' }
  | { type: 'resolve_started' }
  | { type: 'resolve_succeeded'; resolution: ResolveDestinationResponse }
  | { type: 'resolve_not_found' }
  | { type: 'resolve_failed'; message: string }
  | { type: 'confirmation_cancelled' }
  | { type: 'otp_requested' }
  | { type: 'otp_sent'; otp: DestinationOtpInfo }
  | { type: 'otp_send_failed'; message: string }
  | { type: 'otp_submitted' }
  | { type: 'otp_verified' }
  | { type: 'otp_failed'; message: string; attemptsLeft: number | null }
  /** `POST /withdrawals` answered DESTINATION_NOT_VERIFIED / DESTINATION_OTP_REQUIRED (lookup TTL elapsed). */
  | { type: 'verification_expired' };

/**
 * Pure state machine for the withdrawal destination step:
 *   entry -> resolving -> resolved -> otp_requesting -> otp -> verified
 *                     \-> verified (partner says known / no OTP)     known chip -> verified
 */
export function destinationReducer(state: DestinationFlowState, event: DestinationEvent): DestinationFlowState {
  switch (event.type) {
    case 'input_changed':
      return { input: event.value, phase: { phase: 'entry' }, error: null };
    case 'known_selected':
      return {
        input: event.item.destination,
        error: null,
        phase: {
          phase: 'verified',
          via: 'known_chip',
          payoutDestination: event.item.destination,
          accountName: event.item.accountName,
          resolution: null,
        },
      };
    case 'reset':
      return initialDestinationState;
    case 'resolve_started':
      return { ...state, phase: { phase: 'resolving' }, error: null };
    case 'resolve_succeeded': {
      const { resolution } = event;
      if (!resolution.otpRequired) {
        return {
          ...state,
          error: null,
          phase: {
            phase: 'verified',
            via: resolution.known ? 'known_server' : 'no_otp',
            payoutDestination: resolution.normalizedDestination,
            accountName: resolution.accountName,
            resolution,
          },
        };
      }
      return { ...state, error: null, phase: { phase: 'resolved', resolution } };
    }
    case 'resolve_not_found':
      return { ...state, phase: { phase: 'entry' }, error: { kind: 'not_found' } };
    case 'resolve_failed':
      return { ...state, phase: { phase: 'entry' }, error: { kind: 'generic', message: event.message } };
    case 'confirmation_cancelled':
      return { ...state, phase: { phase: 'entry' }, error: null };
    case 'otp_requested': {
      const resolution = resolutionOf(state.phase);
      if (!resolution) return state;
      return { ...state, error: null, phase: { phase: 'otp_requesting', resolution } };
    }
    case 'otp_sent': {
      const resolution = resolutionOf(state.phase);
      if (!resolution) return state;
      return { ...state, error: null, phase: { phase: 'otp', resolution, otp: event.otp, verifying: false } };
    }
    case 'otp_send_failed': {
      const resolution = resolutionOf(state.phase);
      if (!resolution) return state;
      return { ...state, phase: { phase: 'resolved', resolution }, error: { kind: 'generic', message: event.message } };
    }
    case 'otp_submitted':
      if (state.phase.phase !== 'otp') return state;
      return { ...state, error: null, phase: { ...state.phase, verifying: true } };
    case 'otp_verified': {
      if (state.phase.phase !== 'otp') return state;
      const { resolution } = state.phase;
      return {
        ...state,
        error: null,
        phase: {
          phase: 'verified',
          via: 'otp',
          payoutDestination: resolution.normalizedDestination,
          accountName: resolution.accountName,
          resolution,
        },
      };
    }
    case 'otp_failed':
      if (state.phase.phase !== 'otp') return state;
      return {
        ...state,
        phase: { ...state.phase, verifying: false },
        error: { kind: 'otp_invalid', message: event.message, attemptsLeft: event.attemptsLeft },
      };
    case 'verification_expired':
      return { ...state, phase: { phase: 'entry' }, error: { kind: 'expired' } };
    default:
      return state;
  }
}

function resolutionOf(phase: DestinationPhase): ResolveDestinationResponse | null {
  return 'resolution' in phase ? phase.resolution : null;
}

export function isVerified(state: DestinationFlowState): state is DestinationFlowState & {
  phase: Extract<DestinationPhase, { phase: 'verified' }>;
} {
  return state.phase.phase === 'verified';
}

export function isBusy(state: DestinationFlowState): boolean {
  const p = state.phase;
  return p.phase === 'resolving' || p.phase === 'otp_requesting' || (p.phase === 'otp' && p.verifying);
}

/** A partner lookup is only usable before `validUntil`; re-resolve afterwards. */
export function isResolutionExpired(
  resolution: Pick<ResolveDestinationResponse, 'validUntil'> | null,
  now: Date = new Date(),
): boolean {
  if (!resolution) return false;
  const until = new Date(resolution.validUntil).getTime();
  return Number.isFinite(until) && until <= now.getTime();
}

/** Whole seconds until the lookup expires (0 when already expired / unknown). */
export function resolutionSecondsLeft(
  resolution: Pick<ResolveDestinationResponse, 'validUntil'> | null,
  now: Date = new Date(),
): number {
  if (!resolution) return 0;
  const until = new Date(resolution.validUntil).getTime();
  if (!Number.isFinite(until)) return 0;
  return Math.max(0, Math.ceil((until - now.getTime()) / 1000));
}

/**
 * Does a full destination match a server mask such as `+2519****0137`? Same length and every
 * non-`*` character equal. Used to pair device-remembered numbers with `knownDestinations`.
 */
export function matchesMask(full: string, masked: string): boolean {
  if (full.length !== masked.length) return false;
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] !== '*' && masked[i] !== full[i]) return false;
  }
  return true;
}
