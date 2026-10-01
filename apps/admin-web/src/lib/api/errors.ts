import { type ApiErrorEnvelope, ErrorCode } from '@rap/shared';

export interface FieldError {
  field: string;
  messages: string[];
}

/** Error thrown by the API client for any non-2xx response (and network failures). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | string;
  readonly details: unknown;

  constructor(envelope: ApiErrorEnvelope | { statusCode: number; code: string; message: string; details?: unknown }) {
    super(envelope.message);
    this.name = 'ApiError';
    this.status = envelope.statusCode;
    this.code = envelope.code;
    this.details = envelope.details;
  }

  static network(message = 'Network error - is the API running?'): ApiError {
    return new ApiError({ statusCode: 0, code: 'NETWORK_ERROR', message });
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }

  get isAuth(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  /** Roles the API said would be allowed (403 ROLE_NOT_ALLOWED). */
  get requiredRoles(): string[] | null {
    const d = this.details as { requiredRoles?: unknown } | undefined;
    return Array.isArray(d?.requiredRoles) ? (d!.requiredRoles as string[]) : null;
  }

  get retryAfterSeconds(): number | null {
    const d = this.details as { retryAfterSeconds?: unknown } | undefined;
    return typeof d?.retryAfterSeconds === 'number' ? d.retryAfterSeconds : null;
  }

  /** Validation errors mapped by field (400 VALIDATION_ERROR). */
  get fieldErrors(): FieldError[] {
    return getFieldErrors(this);
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function getFieldErrors(error: unknown): FieldError[] {
  if (!isApiError(error) || error.code !== ErrorCode.VALIDATION_ERROR) return [];
  if (!Array.isArray(error.details)) return [];
  return error.details
    .filter(
      (d): d is FieldError =>
        typeof d === 'object' && d !== null && typeof (d as FieldError).field === 'string' && Array.isArray((d as FieldError).messages),
    )
    .map((d) => ({ field: d.field, messages: d.messages.map(String) }));
}

/** Map API field errors onto a react-hook-form instance. Returns the fields that were matched. */
export function applyFieldErrors(
  error: unknown,
  setError: (name: string, error: { type: string; message: string }) => void,
  knownFields?: readonly string[],
): string[] {
  const applied: string[] = [];
  for (const fe of getFieldErrors(error)) {
    const root = fe.field.split('.')[0]!;
    const name = knownFields ? (knownFields.includes(fe.field) ? fe.field : knownFields.includes(root) ? root : null) : fe.field;
    if (!name) continue;
    setError(name, { type: 'server', message: fe.messages.join('. ') });
    applied.push(name);
  }
  return applied;
}

const FRIENDLY: Partial<Record<string, string>> = {
  [ErrorCode.INVALID_CREDENTIALS]: 'Incorrect email or password.',
  [ErrorCode.ADMIN_INACTIVE]: 'This admin account has been deactivated.',
  [ErrorCode.ROLE_NOT_ALLOWED]: 'Your role is not allowed to perform this action.',
  [ErrorCode.DUAL_APPROVAL_SAME_ADMIN]: 'A different admin must provide the second approval.',
  [ErrorCode.DUAL_APPROVAL_ROLE_REQUIRED]: 'Only finance or super admins can decide withdrawals.',
  [ErrorCode.ADJUSTMENT_SELF_APPROVAL_FORBIDDEN]: 'You cannot approve your own adjustment request.',
  [ErrorCode.ADJUSTMENT_NOT_PENDING]: 'This request has already been decided.',
  [ErrorCode.WITHDRAWAL_NOT_REVIEWABLE]: 'This withdrawal is not in a reviewable state.',
  [ErrorCode.AD_NOT_PENDING]: 'This ad has already been reviewed.',
  [ErrorCode.REJECTION_REASON_REQUIRED]: 'A rejection reason is required.',
  [ErrorCode.FLAG_ALREADY_RESOLVED]: 'This flag has already been resolved.',
  [ErrorCode.USER_INVALID_STATE]: 'The user is already in that state.',
  [ErrorCode.CAMPAIGN_INVALID_STATE]: 'The campaign is not in a state that allows this action.',
  [ErrorCode.INSUFFICIENT_BALANCE]: 'The deduction exceeds the user’s balance.',
  [ErrorCode.CAMPAIGN_BUDGET_EXHAUSTED]: 'The campaign budget is exhausted; the reward cannot be credited.',
  [ErrorCode.CAMPAIGN_NOT_CHARGEABLE]: 'The campaign is no longer live (or has no reserved budget left), so this reward cannot be charged to it. The flag was left open - escalate or confirm it instead.',
  [ErrorCode.CAMPAIGN_UNDERFUNDED]: 'The wallet reservation does not cover this campaign budget. Reject it; the advertiser must resubmit.',
  [ErrorCode.RATE_LIMITED]: 'Too many requests. Please slow down.',
  [ErrorCode.NOT_FOUND]: 'Not found.',
  [ErrorCode.CONFLICT]: 'The record changed in the meantime. Refresh and try again.',
  [ErrorCode.SERVICE_UNAVAILABLE]: 'A downstream provider is unavailable right now.',
  [ErrorCode.INTERNAL_ERROR]: 'Something went wrong on the server.',
  [ErrorCode.MEDIA_NOT_READY]: 'The media pipeline has not finished (or failed) for this creative. Wait for processing or reprocess the media before approving.',
  [ErrorCode.KYC_NOT_PENDING]: 'This KYC submission has already been decided.',
  [ErrorCode.ALERT_ALREADY_ACKNOWLEDGED]: 'This alert was already acknowledged by someone else.',
  [ErrorCode.IMPERSONATION_READ_ONLY]: 'Impersonation sessions are read-only: no changes can be made on behalf of the user.',
  [ErrorCode.DELETION_REQUEST_NOT_PENDING]: 'This deletion request is no longer pending.',
  [ErrorCode.DELETION_BLOCKED_PENDING_WITHDRAWALS]: 'Deletion is blocked while the user still has withdrawals in flight. Decide those first.',
  [ErrorCode.IDEMPOTENCY_KEY_REUSED]: 'This request was already submitted. The list has been refreshed.',
  NETWORK_ERROR: 'Cannot reach the API. Check that it is running.',
};

/** Human-friendly message, branching on `code` (never on the server message). */
export function describeError(error: unknown): string {
  if (isApiError(error)) {
    const friendly = FRIENDLY[error.code];
    if (error.code === ErrorCode.VALIDATION_ERROR) {
      const fields = getFieldErrors(error);
      if (fields.length) return fields.map((f) => `${f.field}: ${f.messages.join(', ')}`).join(' · ');
      const missing = (error.details as { missing?: string[] } | undefined)?.missing;
      if (missing?.length) return `Missing checklist items: ${missing.join(', ')}`;
      return error.message || 'Validation failed.';
    }
    if (error.code === ErrorCode.RATE_LIMITED && error.retryAfterSeconds)
      return `Too many requests. Try again in ${error.retryAfterSeconds}s.`;
    return friendly ?? error.message ?? 'Request failed.';
  }
  if (error instanceof Error) return error.message;
  return 'Unexpected error.';
}
