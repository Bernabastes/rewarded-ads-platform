import { API_ROUTES, AUTH_MODE_COOKIE, AUTH_MODE_HEADER, ErrorCode, type AuthTokens, type CookieModeAuthTokens } from '@rap/shared';
import { ApiError, ClientErrorCode, isApiErrorEnvelope } from './errors';

/** Tokens as held by the web client: body mode (legacy) or cookie mode (security audit #16). */
export type SessionTokens = AuthTokens | CookieModeAuthTokens;

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

/** Accept plain option objects (interfaces without index signatures) as query params. */
export type QueryInput = { [key: string]: string | number | boolean | null | undefined } | object;

export interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  query?: QueryInput;
  /** Attach the bearer token and run the refresh-on-401 flow (default true). */
  auth?: boolean;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export interface TokenStore {
  get(): SessionTokens | null;
  set(tokens: SessionTokens): void;
  /** Called once when the session cannot be recovered (refresh failed / reuse detected). */
  expire(reason: string): void;
  /** ms epoch when the current access token expires, if known. */
  getAccessTokenExpiry?(): number | null;
}

export interface ApiClientOptions {
  baseUrl: string;
  tokens: TokenStore;
  fetchFn?: typeof fetch;
  now?: () => number;
  /** Refresh proactively when the access token expires within this many ms (default 20s). */
  refreshLeewayMs?: number;
}

export function buildQuery(query?: QueryInput): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query as QueryParams)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/**
 * Thin fetch wrapper implementing the platform conventions: JSON envelopes, bearer auth, a single in-flight
 * refresh shared by every concurrent 401 (queued requests retry once the new token is in), and forced logout
 * when the refresh itself fails (`REFRESH_TOKEN_REUSED`, expired refresh token…).
 */
export class ApiClient {
  private refreshPromise: Promise<SessionTokens | null> | null = null;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly refreshLeewayMs: number;

  constructor(private readonly options: ApiClientOptions) {
    this.fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? (() => Date.now());
    this.refreshLeewayMs = options.refreshLeewayMs ?? 20_000;
  }

  get<T>(path: string, options: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  post<T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'POST', body });
  }

  patch<T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PATCH', body });
  }

  delete<T = void>(path: string, options: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const useAuth = options.auth !== false;

    if (useAuth) await this.ensureFreshToken();

    let response = await this.send(
      path,
      options,
      useAuth ? this.options.tokens.get()?.accessToken : undefined,
    );

    if (response.status === 401 && useAuth) {
      const error = await this.toError(response);
      const fresh = await this.refresh(error.code);
      if (!fresh) throw error;
      response = await this.send(path, options, fresh.accessToken);
    }

    return this.parse<T>(response);
  }

  /** Single-flight refresh: concurrent callers share one network call and one token rotation. */
  refresh(triggerCode?: string): Promise<SessionTokens | null> {
    if (this.refreshPromise) return this.refreshPromise;
    const current = this.options.tokens.get();
    if (!current) {
      this.options.tokens.expire(triggerCode ?? ErrorCode.UNAUTHORIZED);
      return Promise.resolve(null);
    }
    this.refreshPromise = (async () => {
      try {
        // Security audit #16: cookie mode - the httpOnly rap_refresh cookie carries the token, the body is empty.
        const response = await this.fetchFn(`${this.options.baseUrl}${API_ROUTES.auth.refresh}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', [AUTH_MODE_HEADER]: AUTH_MODE_COOKIE },
          credentials: 'include',
          body: JSON.stringify({}),
        });
        if (!response.ok) {
          const error = await this.toError(response);
          this.options.tokens.expire(error.code);
          return null;
        }
        const tokens = (await response.json()) as CookieModeAuthTokens;
        this.options.tokens.set(tokens);
        return tokens;
      } catch (error) {
        // Network failure: keep the session so the user can retry once back online.
        throw ApiError.fromUnknown(error);
      } finally {
        this.refreshPromise = null;
      }
    })();
    return this.refreshPromise;
  }

  private async ensureFreshToken(): Promise<void> {
    const expiry = this.options.tokens.getAccessTokenExpiry?.();
    const tokens = this.options.tokens.get();
    if (!tokens || expiry == null) return;
    if (expiry - this.now() <= this.refreshLeewayMs) {
      try {
        await this.refresh(ErrorCode.TOKEN_EXPIRED);
      } catch {
        // fall through: the actual request will surface the network error
      }
    }
  }

  private async send(path: string, options: RequestOptions, accessToken?: string): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
    let body: BodyInit | undefined;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    try {
      return await this.fetchFn(`${this.options.baseUrl}${path}${buildQuery(options.query)}`, {
        method: options.method ?? 'GET',
        headers,
        // cookie-mode auth endpoints (login / logout) need the httpOnly refresh cookie to travel
        credentials: 'include',
        body,
        signal: options.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw ApiError.network();
    }
  }

  private async parse<T>(response: Response): Promise<T> {
    if (response.ok) {
      if (response.status === 204) return undefined as T;
      const text = await response.text();
      if (!text) return undefined as T;
      return JSON.parse(text) as T;
    }
    throw await this.toError(response);
  }

  private async toError(response: Response): Promise<ApiError> {
    let payload: unknown = null;
    try {
      payload = await response.clone().json();
    } catch {
      payload = null;
    }
    if (isApiErrorEnvelope(payload)) return new ApiError(payload);
    return new ApiError({
      statusCode: response.status,
      code: response.status === 401 ? ErrorCode.UNAUTHORIZED : ClientErrorCode.UNKNOWN_ERROR,
      message: response.statusText || `Request failed with status ${response.status}`,
    });
  }
}
