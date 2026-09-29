import { ErrorCode, type ApiErrorEnvelope } from '@rap/shared';

/** Client-side codes for failures that never reached the API envelope. */
export const ClientErrorCode = {
  NETWORK_ERROR: 'NETWORK_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
  UPLOAD_FAILED: 'UPLOAD_FAILED',
  /** An idempotent top-up was still in flight on the server after we stopped waiting. */
  TOPUP_STILL_PROCESSING: 'TOPUP_STILL_PROCESSING',
} as const;

export type AnyErrorCode = ErrorCode | (typeof ClientErrorCode)[keyof typeof ClientErrorCode];

export interface ValidationDetail {
  field: string;
  messages: string[];
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: AnyErrorCode;
  readonly details: unknown;

  constructor(envelope: { statusCode: number; code: AnyErrorCode; message: string; details?: unknown }) {
    super(envelope.message);
    this.name = 'ApiError';
    this.statusCode = envelope.statusCode;
    this.code = envelope.code;
    this.details = envelope.details;
  }

  static network(message = 'Could not reach the server'): ApiError {
    return new ApiError({ statusCode: 0, code: ClientErrorCode.NETWORK_ERROR, message });
  }

  static fromUnknown(error: unknown): ApiError {
    if (error instanceof ApiError) return error;
    if (error instanceof TypeError) return ApiError.network();
    const message = error instanceof Error ? error.message : 'Something went wrong';
    return new ApiError({ statusCode: 0, code: ClientErrorCode.UNKNOWN_ERROR, message });
  }

  get isAuthError(): boolean {
    return this.statusCode === 401;
  }

  get validationDetails(): ValidationDetail[] {
    if (this.code !== ErrorCode.VALIDATION_ERROR || !Array.isArray(this.details)) return [];
    return this.details.filter(
      (d): d is ValidationDetail =>
        typeof d === 'object' && d !== null && typeof (d as ValidationDetail).field === 'string',
    );
  }

  get retryAfterSeconds(): number | null {
    const details = this.details as { retryAfterSeconds?: unknown } | undefined;
    return typeof details?.retryAfterSeconds === 'number' ? details.retryAfterSeconds : null;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isApiErrorEnvelope(value: unknown): value is ApiErrorEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ApiErrorEnvelope).code === 'string' &&
    typeof (value as ApiErrorEnvelope).statusCode === 'number'
  );
}

export interface ErrorDescription {
  title: string;
  description?: string;
}

const MESSAGES: Partial<Record<AnyErrorCode, ErrorDescription>> = {
  [ClientErrorCode.NETWORK_ERROR]: {
    title: 'You appear to be offline',
    description: 'Check your connection and try again.',
  },
  [ErrorCode.VALIDATION_ERROR]: { title: 'Please check the highlighted fields' },
  [ErrorCode.NOT_FOUND]: { title: 'We could not find that', description: 'It may have been removed.' },
  [ErrorCode.UNAUTHORIZED]: { title: 'Please sign in again' },
  [ErrorCode.TOKEN_EXPIRED]: { title: 'Your session expired', description: 'Sign in to continue.' },
  [ErrorCode.INVALID_TOKEN]: {
    title: 'Your session is no longer valid',
    description: 'Sign in to continue.',
  },
  [ErrorCode.REFRESH_TOKEN_REUSED]: {
    title: 'You were signed out for your security',
    description: 'We detected your session being used elsewhere. Please sign in again.',
  },
  [ErrorCode.FORBIDDEN]: { title: 'You do not have access to that' },
  [ErrorCode.ROLE_NOT_ALLOWED]: { title: 'Your account cannot perform this action' },
  [ErrorCode.CONFLICT]: {
    title: 'That change conflicts with the current state',
    description: 'Refresh and try again.',
  },
  [ErrorCode.RATE_LIMITED]: {
    title: 'Too many requests',
    description: 'Please wait a moment and try again.',
  },
  [ErrorCode.INTERNAL_ERROR]: {
    title: 'Something went wrong on our side',
    description: 'Please try again shortly.',
  },
  [ErrorCode.SERVICE_UNAVAILABLE]: {
    title: 'A service is temporarily unavailable',
    description: 'Please try again in a few minutes.',
  },
  [ErrorCode.INVALID_CREDENTIALS]: {
    title: 'Incorrect email or password',
    description: 'Double-check your details and try again.',
  },
  [ErrorCode.EMAIL_ALREADY_REGISTERED]: {
    title: 'This email is already registered',
    description: 'Sign in instead, or use a different contact email.',
  },
  [ErrorCode.ADVERTISER_NOT_VERIFIED]: {
    title: 'Your business is not verified yet',
    description:
      'Our team is reviewing your registration. You can prepare drafts now and submit once verified.',
  },
  [ErrorCode.INSUFFICIENT_WALLET_BALANCE]: {
    title: 'Not enough funds in your wallet',
    description: 'Add funds to reserve this campaign budget.',
  },
  [ErrorCode.CAMPAIGN_INVALID_STATE]: {
    title: 'This action is not available for the campaign right now',
    description: 'Refresh to see its current status.',
  },
  [ErrorCode.CAMPAIGN_HAS_NO_ADS]: {
    title: 'Add a creative before submitting',
    description: 'Video campaigns need at least one uploaded ad.',
  },
  [ErrorCode.UPLOAD_TYPE_NOT_ALLOWED]: {
    title: 'That file type is not allowed',
    description: 'Upload MP4/WebM video or JPEG/PNG/WebP images.',
  },
  [ErrorCode.PAYMENT_NOT_FOUND]: { title: 'We could not find that payment' },
  [ErrorCode.PAYMENT_ALREADY_PROCESSED]: { title: 'This payment has already been processed' },
  [ErrorCode.ACCOUNT_SUSPENDED]: {
    title: 'Your account is suspended',
    description: 'Contact support to resolve this.',
  },
  [ErrorCode.ACCOUNT_BANNED]: { title: 'Your account has been closed', description: 'Contact support.' },
  [ErrorCode.CONSENT_REQUIRED]: {
    title: 'Please accept the current advertiser terms',
    description: 'Review and accept the latest terms to submit campaigns.',
  },
  [ErrorCode.CONSENT_VERSION_OUTDATED]: {
    title: 'The terms were updated while you were reading',
    description: 'We loaded the newest version — please review and accept it.',
  },
  [ErrorCode.IDEMPOTENCY_KEY_REUSED]: {
    title: 'We are still processing your previous request',
    description: 'Please wait a moment; nothing has been charged twice.',
  },
  [ErrorCode.MEDIA_NOT_READY]: {
    title: 'The creative is still being processed',
    description: 'Wait for processing to finish and try again.',
  },
  [ClientErrorCode.UPLOAD_FAILED]: {
    title: 'Upload failed',
    description: 'The file could not be stored. Please try again.',
  },
  [ClientErrorCode.TOPUP_STILL_PROCESSING]: {
    title: 'Your top-up is still being processed',
    description: 'Check your payment history in a moment — do not start a second payment.',
  },
};

/** Human-friendly copy keyed on the stable error code (never on the server message). */
export function describeApiError(error: unknown): ErrorDescription {
  const apiError = ApiError.fromUnknown(error);
  const known = MESSAGES[apiError.code];
  if (known) {
    if (apiError.code === ErrorCode.RATE_LIMITED && apiError.retryAfterSeconds) {
      return { ...known, description: `Please try again in ${apiError.retryAfterSeconds}s.` };
    }
    return known;
  }
  if (apiError.statusCode >= 500) return MESSAGES[ErrorCode.INTERNAL_ERROR]!;
  return { title: 'Something went wrong', description: 'Please try again.' };
}

/**
 * Map `400 VALIDATION_ERROR` details to form fields. Returns `{ field: message }` for the fields that exist on
 * the form (optionally translated through `fieldMap`) plus the leftover messages for a form-level banner.
 */
export function mapValidationErrors(
  error: unknown,
  knownFields: readonly string[],
  fieldMap: Record<string, string> = {},
): { fieldErrors: Record<string, string>; formErrors: string[] } {
  const fieldErrors: Record<string, string> = {};
  const formErrors: string[] = [];
  if (!isApiError(error)) return { fieldErrors, formErrors };
  for (const detail of error.validationDetails) {
    const target = fieldMap[detail.field] ?? detail.field;
    const message = detail.messages[0] ?? 'Invalid value';
    if (knownFields.includes(target)) {
      fieldErrors[target] = fieldErrors[target] ?? prettifyServerMessage(message, target);
    } else {
      formErrors.push(prettifyServerMessage(message, detail.field));
    }
  }
  return { fieldErrors, formErrors };
}

/** class-validator messages start with the property name; make them read like UI copy. */
export function prettifyServerMessage(message: string, field: string): string {
  const label = field
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/\betb\b/g, 'ETB');
  const withLabel = message.startsWith(field) ? `${label}${message.slice(field.length)}` : message;
  return withLabel.charAt(0).toUpperCase() + withLabel.slice(1);
}
