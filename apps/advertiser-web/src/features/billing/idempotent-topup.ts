import { ErrorCode, type CreateTopupDto, type IdempotencyConflictDetails, type TopupResponse } from '@rap/shared';
import { billingApi } from '@/lib/api';
import { ApiError, ClientErrorCode, isApiError } from '@/lib/api/errors';

export interface IdempotentTopupOptions {
  /** Per-intent key; reused on retries of the same payload. */
  idempotencyKey: string;
  /** Delay between polls while the original request is still running (default 1.5 s). */
  pollIntervalMs?: number;
  /** Max polls before giving up (default 20 ≈ 30 s). */
  maxPolls?: number;
  /** Test seams. */
  request?: (dto: CreateTopupDto, key: string) => Promise<TopupResponse>;
  sleep?: (ms: number) => Promise<void>;
  /** Called before each wait while the original request is still in progress. */
  onPoll?: (attempt: number) => void;
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Fallback for very old browsers: RFC 4122-ish random id within the API's allowed alphabet.
  return `topup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function conflictDetails(error: ApiError): IdempotencyConflictDetails | null {
  const details = error.details as Partial<IdempotencyConflictDetails> | undefined;
  return details && typeof details.inProgress === 'boolean'
    ? { key: String(details.key ?? ''), inProgress: details.inProgress }
    : null;
}

/**
 * `POST /billing/topups` with the idempotency protocol:
 *
 * - the same key is sent on every retry of the same intent, so a duplicate submit (double click, flaky
 *   network) replays the stored payment instead of charging twice;
 * - `409 IDEMPOTENCY_KEY_REUSED { inProgress: true }` means the first request is still running — we wait and
 *   re-send the identical request, which the API answers with the memoised response once it finishes
 *   (this is the only handle we have on the in-flight payment, so re-sending *is* the poll);
 * - `409 … { inProgress: false }` means a different payload was sent under an old key (client bug): the
 *   caller must generate a fresh key, so we surface it as-is.
 */
export async function createTopupIdempotent(
  dto: CreateTopupDto,
  options: IdempotentTopupOptions,
): Promise<TopupResponse> {
  const request = options.request ?? ((body, key) => billingApi.createTopup(body, { idempotencyKey: key }));
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const interval = options.pollIntervalMs ?? 1_500;
  const maxPolls = options.maxPolls ?? 20;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await request(dto, options.idempotencyKey);
    } catch (error) {
      if (!isApiError(error) || error.code !== ErrorCode.IDEMPOTENCY_KEY_REUSED) throw error;
      const details = conflictDetails(error);
      if (!details?.inProgress) throw error;
      if (attempt >= maxPolls) {
        throw new ApiError({
          statusCode: 409,
          code: ClientErrorCode.TOPUP_STILL_PROCESSING,
          message: 'The previous top-up request is still being processed',
          details,
        });
      }
      options.onPoll?.(attempt + 1);
      await sleep(interval);
    }
  }
}
