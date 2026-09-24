import type { ApiErrorEnvelope, ErrorCode } from '@rap/shared';

/** Client-only codes that never come from the server envelope. */
export const ClientErrorCode = {
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  UNKNOWN: 'UNKNOWN',
} as const;
export type ClientErrorCode = (typeof ClientErrorCode)[keyof typeof ClientErrorCode];

export type AnyErrorCode = ErrorCode | ClientErrorCode;

export interface ValidationDetail {
  field: string;
  messages: string[];
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: AnyErrorCode;
  readonly details: unknown;

  constructor(statusCode: number, code: AnyErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static fromEnvelope(envelope: Partial<ApiErrorEnvelope>, fallbackStatus: number): ApiError {
    return new ApiError(
      envelope.statusCode ?? fallbackStatus,
      (envelope.code as ErrorCode | undefined) ?? 'INTERNAL_ERROR',
      envelope.message ?? 'Request failed',
      envelope.details,
    );
  }

  static network(message = 'Network request failed'): ApiError {
    return new ApiError(0, ClientErrorCode.NETWORK_ERROR, message);
  }

  get isNetworkError(): boolean {
    return this.code === ClientErrorCode.NETWORK_ERROR || this.code === ClientErrorCode.TIMEOUT;
  }

  /** `details.retryAfterSeconds` for 429 responses, when present. */
  get retryAfterSeconds(): number | null {
    const details = this.details as { retryAfterSeconds?: unknown } | undefined;
    return typeof details?.retryAfterSeconds === 'number' ? details.retryAfterSeconds : null;
  }

  /** `details.attemptsRemaining` for OTP errors, when present. */
  get attemptsRemaining(): number | null {
    const details = this.details as { attemptsRemaining?: unknown } | undefined;
    return typeof details?.attemptsRemaining === 'number' ? details.attemptsRemaining : null;
  }

  /** Field-level validation messages for 400 VALIDATION_ERROR. */
  get validationDetails(): ValidationDetail[] {
    if (!Array.isArray(this.details)) return [];
    return this.details.filter(
      (d): d is ValidationDetail =>
        typeof d === 'object' && d !== null && typeof (d as ValidationDetail).field === 'string',
    );
  }

  fieldMessage(field: string): string | null {
    const match = this.validationDetails.find((d) => d.field === field);
    return match?.messages?.[0] ?? null;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function errorCodeOf(error: unknown): AnyErrorCode | null {
  return isApiError(error) ? error.code : null;
}
