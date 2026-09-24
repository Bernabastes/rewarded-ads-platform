import { API_ROUTES, type AuthTokens, ErrorCode } from '@rap/shared';
import { ApiError } from './errors';
import type { StoredTokens, TokenStore } from './token-store';

export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue>;

export interface RequestOptions {
  query?: QueryParams;
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** Do not attach / refresh credentials (login, refresh, logout). */
  anonymous?: boolean;
}

export type AuthLostReason = 'refresh_failed' | 'unauthorized';

export interface ApiClientOptions {
  baseUrl: string;
  tokens: TokenStore;
  fetch?: typeof fetch;
  /** Called once the session cannot be recovered (tokens are already cleared). */
  onAuthLost?: (reason: AuthLostReason) => void;
  /** Refresh proactively when the access token expires within this many ms. */
  refreshSkewMs?: number;
}

const DEFAULT_SKEW_MS = 20_000;

export function buildQuery(params?: QueryParams): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    sp.append(key, typeof value === 'boolean' ? String(value) : String(value));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function toEnvelope(status: number, data: unknown, fallbackMessage: string) {
  const d = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  return {
    statusCode: typeof d.statusCode === 'number' ? d.statusCode : status,
    code: typeof d.code === 'string' ? d.code : status === 401 ? ErrorCode.UNAUTHORIZED : status === 403 ? ErrorCode.FORBIDDEN : ErrorCode.INTERNAL_ERROR,
    message: typeof d.message === 'string' ? d.message : fallbackMessage,
    details: d.details,
  };
}

/**
 * Thin fetch wrapper implementing the platform auth contract:
 *  - Bearer access token on every request;
 *  - proactive refresh shortly before expiry, and reactive refresh on `401 TOKEN_EXPIRED`;
 *  - a single in-flight refresh shared by all concurrent callers (queued retries);
 *  - tokens cleared + `onAuthLost` when the refresh fails (incl. `REFRESH_TOKEN_REUSED`).
 */
export class ApiClient {
  private refreshPromise: Promise<StoredTokens | null> | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ApiClientOptions) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  }

  get<T>(path: string, options?: Omit<RequestOptions, 'body'>): Promise<T> {
    return this.request<T>('GET', path, options);
  }

  post<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>): Promise<T> {
    return this.request<T>('POST', path, { ...options, body });
  }

  patch<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>): Promise<T> {
    return this.request<T>('PATCH', path, { ...options, body });
  }

  delete<T>(path: string, options?: Omit<RequestOptions, 'body'>): Promise<T> {
    return this.request<T>('DELETE', path, options);
  }

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    if (!options.anonymous) await this.ensureFreshToken();
    return this.perform<T>(method, path, options, false);
  }

  /** Force a refresh (shared with any refresh already in flight). */
  refresh(): Promise<StoredTokens | null> {
    if (this.refreshPromise) return this.refreshPromise;
    const current = this.options.tokens.get();
    if (!current) return Promise.resolve(null);
    this.refreshPromise = this.doRefresh(current).finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async ensureFreshToken(): Promise<void> {
    const tokens = this.options.tokens.get();
    if (!tokens) return;
    const skew = this.options.refreshSkewMs ?? DEFAULT_SKEW_MS;
    if (tokens.expiresAt && tokens.expiresAt - Date.now() < skew) {
      await this.refresh();
    }
  }

  private async doRefresh(current: StoredTokens): Promise<StoredTokens | null> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.options.baseUrl}${API_ROUTES.auth.refresh}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ refreshToken: current.refreshToken }),
      });
    } catch {
      // Network blip: keep the tokens; the original request will surface a network error.
      return null;
    }
    if (!res.ok) {
      // Only give up if our refresh token is still the one that failed (a parallel tab may have rotated it).
      if (this.options.tokens.get()?.refreshToken === current.refreshToken) {
        this.options.tokens.clear();
        this.options.onAuthLost?.('refresh_failed');
      }
      return this.options.tokens.get();
    }
    const tokens = (await res.json()) as AuthTokens;
    return this.options.tokens.set(tokens);
  }

  private async perform<T>(method: string, path: string, options: RequestOptions, retried: boolean): Promise<T> {
    const tokens = options.anonymous ? null : this.options.tokens.get();
    const headers: Record<string, string> = { accept: 'application/json', ...options.headers };
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (tokens) headers.authorization = `Bearer ${tokens.accessToken}`;

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.options.baseUrl}${path}${buildQuery(options.query)}`, {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: options.signal,
      });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      throw ApiError.network();
    }

    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data = text ? safeJson(text) : undefined;
    if (res.ok) return data as T;

    const envelope = toEnvelope(res.status, data, res.statusText || 'Request failed');

    if (res.status === 401 && tokens && !options.anonymous) {
      const latest = this.options.tokens.get();
      // Another caller already rotated the token while we were in flight: just retry with it.
      if (latest && latest.accessToken !== tokens.accessToken && !retried) {
        return this.perform<T>(method, path, options, true);
      }
      if (envelope.code === ErrorCode.TOKEN_EXPIRED && !retried) {
        const refreshed = await this.refresh();
        if (refreshed) return this.perform<T>(method, path, options, true);
        throw new ApiError(envelope);
      }
      if (envelope.code !== ErrorCode.TOKEN_EXPIRED) {
        // Invalid / revoked token: the session is gone.
        if (this.options.tokens.get()?.accessToken === tokens.accessToken) {
          this.options.tokens.clear();
          this.options.onAuthLost?.('unauthorized');
        }
      }
    }
    throw new ApiError(envelope);
  }
}
