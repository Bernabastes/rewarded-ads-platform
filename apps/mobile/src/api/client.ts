import type { ApiErrorEnvelope, AuthTokens } from '@rap/shared';
import { API_BASE_PATH, API_ROUTES, ErrorCode } from '@rap/shared';

import { ApiError, ClientErrorCode } from './errors';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export type QueryParams = { [key: string]: string | number | boolean | undefined | null };

export interface RequestOptions {
  body?: unknown;
  query?: object;
  /** Attach the bearer token (default true). Public endpoints set this to false. */
  auth?: boolean;
  /** Abort after this many ms (default 20s). */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Extra request headers (e.g. `Idempotency-Key` on money POSTs). */
  headers?: Record<string, string>;
}

export interface TokenStore {
  get(): Promise<AuthTokens | null>;
  set(tokens: AuthTokens | null): Promise<void>;
}

export interface ApiClientOptions {
  baseUrl: string;
  tokenStore: TokenStore;
  fetchFn?: typeof fetch;
  /** Called after a refresh definitively fails (tokens are already cleared). */
  onAuthFailure?: (code: string) => void;
  /** Called when the server says the account cannot be used (403 AGE_RESTRICTED / ACCOUNT_SUSPENDED / ACCOUNT_BANNED). */
  onAccountBlocked?: (code: string) => void;
  /** Called on 403 CONSENT_REQUIRED with the legal document kinds that must be accepted. */
  onConsentRequired?: (kinds: string[]) => void;
  defaultTimeoutMs?: number;
}

const BLOCKING_CODES = new Set<string>([
  ErrorCode.AGE_RESTRICTED,
  ErrorCode.ACCOUNT_SUSPENDED,
  ErrorCode.ACCOUNT_BANNED,
]);

/** `details.requiresConsent` of a 403 CONSENT_REQUIRED envelope (empty when absent). */
export function consentKindsOf(details: unknown): string[] {
  const list = (details as { requiresConsent?: unknown } | null | undefined)?.requiresConsent;
  return Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string') : [];
}

/**
 * Thin typed fetch wrapper implementing the platform auth conventions:
 *  - bearer access token, 15-minute lifetime;
 *  - on 401 for an authenticated request, refresh ONCE with a single in-flight refresh promise
 *    (concurrent callers queue on the same promise) and retry the original request once;
 *  - a second 401 after the refresh (e.g. `INVALID_TOKEN` for a denylisted access token) clears the
 *    session and fires `onAuthFailure`;
 *  - refresh failure (incl. REFRESH_TOKEN_REUSED) clears tokens and fires `onAuthFailure`;
 *  - every error is surfaced as `ApiError` carrying the stable server `code`.
 */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly tokenStore: TokenStore;
  private readonly fetchFn: typeof fetch;
  private readonly onAuthFailure?: (code: string) => void;
  private readonly onAccountBlocked?: (code: string) => void;
  private readonly onConsentRequired?: (kinds: string[]) => void;
  private readonly defaultTimeoutMs: number;
  private refreshPromise: Promise<AuthTokens | null> | null = null;

  constructor(options: ApiClientOptions) {
    this.baseUrl = `${options.baseUrl.replace(/\/+$/, '')}${API_BASE_PATH}`;
    this.tokenStore = options.tokenStore;
    this.fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));
    this.onAuthFailure = options.onAuthFailure;
    this.onAccountBlocked = options.onAccountBlocked;
    this.onConsentRequired = options.onConsentRequired;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 20_000;
  }

  get<T>(path: string, options: Omit<RequestOptions, 'body'> = {}) {
    return this.request<T>('GET', path, options);
  }
  post<T>(path: string, body?: unknown, options: Omit<RequestOptions, 'body'> = {}) {
    return this.request<T>('POST', path, { ...options, body });
  }
  patch<T>(path: string, body?: unknown, options: Omit<RequestOptions, 'body'> = {}) {
    return this.request<T>('PATCH', path, { ...options, body });
  }
  delete<T>(path: string, options: Omit<RequestOptions, 'body'> = {}) {
    return this.request<T>('DELETE', path, options);
  }

  /** True when the refresh dance is currently running (used by tests / UI hints). */
  get isRefreshing(): boolean {
    return this.refreshPromise !== null;
  }

  async request<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
    const useAuth = options.auth !== false;
    // If a refresh is already in flight, wait for it so we do not send a token we know is stale.
    if (useAuth && this.refreshPromise) await this.refreshPromise.catch(() => null);

    let tokens = useAuth ? await this.tokenStore.get() : null;
    let response = await this.send(method, path, options, tokens?.accessToken);

    if (response.status === 401 && useAuth && tokens) {
      const refreshed = await this.refreshTokens(tokens.refreshToken);
      if (!refreshed) {
        throw await this.toError(response);
      }
      tokens = refreshed;
      response = await this.send(method, path, options, tokens.accessToken);
      if (response.status === 401) {
        // Still unauthorised with a freshly issued token (denylisted / deleted account): the session is unusable.
        const error = await this.toError(response);
        await this.tokenStore.set(null);
        this.onAuthFailure?.(error.code);
        throw error;
      }
    }

    if (!response.ok) {
      const error = await this.toError(response);
      if (error.statusCode === 403 && BLOCKING_CODES.has(error.code)) this.onAccountBlocked?.(error.code);
      if (error.statusCode === 403 && error.code === ErrorCode.CONSENT_REQUIRED) {
        this.onConsentRequired?.(consentKindsOf(error.details));
      }
      throw error;
    }

    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApiError(response.status, ClientErrorCode.UNKNOWN, 'Invalid JSON response');
    }
  }

  /**
   * Rotates the refresh token. Concurrent callers share the same promise; the token passed by a
   * late caller is ignored if a refresh already completed with a newer token.
   */
  refreshTokens(refreshToken: string): Promise<AuthTokens | null> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.doRefresh(refreshToken).finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  private async doRefresh(refreshToken: string): Promise<AuthTokens | null> {
    let response: Response;
    try {
      response = await this.send('POST', API_ROUTES.auth.refresh, { body: { refreshToken }, auth: false });
    } catch {
      // Network problem during refresh: keep the tokens, let the caller surface the network error.
      return null;
    }
    if (!response.ok) {
      const error = await this.toError(response);
      await this.tokenStore.set(null);
      this.onAuthFailure?.(error.code);
      return null;
    }
    const tokens = (await response.json()) as AuthTokens;
    await this.tokenStore.set(tokens);
    return tokens;
  }

  /**
   * Logs out: clears the local tokens first, then tells the server to revoke the refresh family and
   * denylist the presented access token (sent as Bearer, F2). Best effort - never throws.
   */
  async logout(): Promise<void> {
    const tokens = await this.tokenStore.get();
    await this.tokenStore.set(null);
    if (!tokens?.refreshToken) return;
    try {
      await this.send(
        'POST',
        API_ROUTES.auth.logout,
        { body: { refreshToken: tokens.refreshToken }, auth: false, timeoutMs: 5000 },
        tokens.accessToken,
      );
    } catch {
      // Best effort: the refresh token expires server-side anyway.
    }
  }

  private buildUrl(path: string, query?: object): string {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    if (!query) return url;
    const params = Object.entries(query as QueryParams)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    return params.length ? `${url}?${params.join('&')}` : url;
  }

  private async send(
    method: HttpMethod,
    path: string,
    options: RequestOptions,
    accessToken?: string,
  ): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? this.defaultTimeoutMs);
    const onExternalAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onExternalAbort);
    try {
      return await this.fetchFn(this.buildUrl(path, options.query), {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted && !options.signal?.aborted) {
        throw new ApiError(0, ClientErrorCode.TIMEOUT, 'Request timed out');
      }
      throw ApiError.network(error instanceof Error ? error.message : undefined);
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  private async toError(response: Response): Promise<ApiError> {
    let payload: Record<string, unknown> | null = null;
    try {
      const text = await response.text();
      payload = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      payload = null;
    }
    if (payload && typeof payload.code === 'string') {
      return ApiError.fromEnvelope(payload as Partial<ApiErrorEnvelope>, response.status);
    }
    const fallbackCode = response.status === 401 ? ErrorCode.UNAUTHORIZED : ErrorCode.INTERNAL_ERROR;
    return new ApiError(response.status, fallbackCode, `HTTP ${response.status}`);
  }
}
