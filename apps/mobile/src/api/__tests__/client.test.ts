import type { AuthTokens } from '@rap/shared';
import { API_BASE_PATH, API_ROUTES, ErrorCode } from '@rap/shared';

import { ApiClient, type TokenStore } from '../client';
import { ApiError, ClientErrorCode } from '../errors';

const BASE = 'http://api.test';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeTokens(suffix: string): AuthTokens {
  return { accessToken: `access-${suffix}`, refreshToken: `refresh-${suffix}`, expiresIn: 900, tokenType: 'Bearer' };
}

function memoryTokenStore(initial: AuthTokens | null): TokenStore & { current: AuthTokens | null } {
  const store = {
    current: initial,
    async get() {
      return store.current;
    },
    async set(tokens: AuthTokens | null) {
      store.current = tokens;
    },
  };
  return store;
}

interface Call {
  url: string;
  init: RequestInit;
}

/** Scripted fetch: hands out responses by matching URL + method, records every call. */
function scriptedFetch(handler: (call: Call, index: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return handler(call, calls.length - 1);
  };
  return { fetchFn, calls };
}

const authHeader = (call: Call) => (call.init.headers as Record<string, string>).Authorization;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Awaits a promise that must reject and returns the ApiError. */
const rejection = (promise: Promise<unknown>): Promise<ApiError> =>
  promise.then(
    () => {
      throw new Error('expected the request to fail');
    },
    (error: unknown) => error as ApiError,
  );

describe('ApiClient', () => {
  it('prefixes the versioned base path, attaches the bearer token and serialises the query', async () => {
    const tokens = memoryTokenStore(makeTokens('1'));
    const { fetchFn, calls } = scriptedFetch(() => jsonResponse(200, { data: [], meta: { page: 2, limit: 20, total: 0 } }));
    const client = new ApiClient({ baseUrl: `${BASE}/`, tokenStore: tokens, fetchFn });

    const result = await client.get(API_ROUTES.users.ledger, { query: { page: 2, limit: 20, status: undefined, q: '' } });

    expect(result).toEqual({ data: [], meta: { page: 2, limit: 20, total: 0 } });
    expect(calls[0].url).toBe(`${BASE}${API_BASE_PATH}/users/me/ledger?page=2&limit=20`);
    expect(authHeader(calls[0])).toBe('Bearer access-1');
    expect(calls[0].init.method).toBe('GET');
  });

  it('returns undefined for 204 and skips the auth header for public endpoints', async () => {
    const tokens = memoryTokenStore(makeTokens('1'));
    const { fetchFn, calls } = scriptedFetch(() => jsonResponse(204, undefined));
    const client = new ApiClient({ baseUrl: BASE, tokenStore: tokens, fetchFn });

    await expect(
      client.post('/auth/otp/request', { phoneNumber: '+251911000000' }, { auth: false }),
    ).resolves.toBeUndefined();
    expect(authHeader(calls[0])).toBeUndefined();
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ phoneNumber: '+251911000000' });
  });

  it('parses the error envelope into ApiError with the stable code and details', async () => {
    const tokens = memoryTokenStore(null);
    const { fetchFn } = scriptedFetch(() =>
      jsonResponse(429, {
        statusCode: 429,
        code: ErrorCode.OTP_RATE_LIMITED,
        message: 'Too many',
        details: { retryAfterSeconds: 42 },
      }),
    );
    const client = new ApiClient({ baseUrl: BASE, tokenStore: tokens, fetchFn });

    const error = await rejection(client.post('/auth/otp/request', {}, { auth: false }));
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe(ErrorCode.OTP_RATE_LIMITED);
    expect(error.statusCode).toBe(429);
    expect(error.retryAfterSeconds).toBe(42);
  });

  it('exposes field-level validation details', () => {
    const error = new ApiError(400, ErrorCode.VALIDATION_ERROR, 'bad', [
      { field: 'fullName', messages: ['fullName must be longer than or equal to 2 characters'] },
    ]);
    expect(error.fieldMessage('fullName')).toMatch(/longer/);
    expect(error.fieldMessage('dateOfBirth')).toBeNull();
  });

  it('wraps fetch failures as NETWORK_ERROR', async () => {
    const tokens = memoryTokenStore(null);
    const fetchFn: typeof fetch = async () => {
      throw new TypeError('Network request failed');
    };
    const client = new ApiClient({ baseUrl: BASE, tokenStore: tokens, fetchFn });
    const error = await rejection(client.get('/ads/feed', { auth: false }));
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe(ClientErrorCode.NETWORK_ERROR);
    expect(error.isNetworkError).toBe(true);
  });

  it('refreshes once on 401 and retries the original request with the new token', async () => {
    const tokens = memoryTokenStore(makeTokens('old'));
    const { fetchFn, calls } = scriptedFetch((call) => {
      if (call.url.endsWith(API_ROUTES.auth.refresh)) {
        expect(JSON.parse(String(call.init.body))).toEqual({ refreshToken: 'refresh-old' });
        return jsonResponse(201, makeTokens('new'));
      }
      if (authHeader(call) === 'Bearer access-old') {
        return jsonResponse(401, { statusCode: 401, code: ErrorCode.TOKEN_EXPIRED, message: 'expired' });
      }
      return jsonResponse(200, { coinBalance: 500 });
    });
    const client = new ApiClient({ baseUrl: BASE, tokenStore: tokens, fetchFn });

    const result = await client.get<{ coinBalance: number }>(API_ROUTES.users.balance);

    expect(result.coinBalance).toBe(500);
    expect(calls.map((c) => c.url.replace(`${BASE}${API_BASE_PATH}`, ''))).toEqual([
      '/users/me/balance',
      '/auth/refresh',
      '/users/me/balance',
    ]);
    expect(authHeader(calls[2])).toBe('Bearer access-new');
    expect(tokens.current?.refreshToken).toBe('refresh-new');
  });

  it('shares a single in-flight refresh between concurrent 401s and retries all of them', async () => {
    const tokens = memoryTokenStore(makeTokens('old'));
    let releaseRefresh: () => void = () => undefined;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const { fetchFn, calls } = scriptedFetch(async (call) => {
      if (call.url.endsWith(API_ROUTES.auth.refresh)) {
        await refreshGate;
        return jsonResponse(201, makeTokens('new'));
      }
      if (authHeader(call) === 'Bearer access-old') {
        return jsonResponse(401, { statusCode: 401, code: ErrorCode.TOKEN_EXPIRED, message: 'expired' });
      }
      return jsonResponse(200, { path: call.url });
    });
    const client = new ApiClient({ baseUrl: BASE, tokenStore: tokens, fetchFn });

    const pending = Promise.all([
      client.get<{ path: string }>(API_ROUTES.users.balance),
      client.get<{ path: string }>(API_ROUTES.users.summary),
      client.get<{ path: string }>(API_ROUTES.ads.feed),
    ]);
    // Let the three 401s land and the refresh start, then release it.
    await sleep(10);
    expect(client.isRefreshing).toBe(true);
    releaseRefresh();
    const results = await pending;

    const refreshCalls = calls.filter((c) => c.url.endsWith(API_ROUTES.auth.refresh));
    expect(refreshCalls).toHaveLength(1);
    expect(results.map((r) => r.path.replace(`${BASE}${API_BASE_PATH}`, ''))).toEqual([
      '/users/me/balance',
      '/users/me/summary',
      '/ads/feed',
    ]);
    const retried = calls.filter((c) => authHeader(c) === 'Bearer access-new');
    expect(retried).toHaveLength(3);
    expect(client.isRefreshing).toBe(false);
  });

  it('waits for an in-flight refresh before sending a new authenticated request', async () => {
    const tokens = memoryTokenStore(makeTokens('old'));
    let releaseRefresh: () => void = () => undefined;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const { fetchFn, calls } = scriptedFetch(async (call) => {
      if (call.url.endsWith(API_ROUTES.auth.refresh)) {
        await refreshGate;
        return jsonResponse(201, makeTokens('new'));
      }
      if (authHeader(call) === 'Bearer access-old') {
        return jsonResponse(401, { statusCode: 401, code: ErrorCode.TOKEN_EXPIRED, message: 'expired' });
      }
      return jsonResponse(200, { ok: true });
    });
    const client = new ApiClient({ baseUrl: BASE, tokenStore: tokens, fetchFn });

    const first = client.get(API_ROUTES.users.balance);
    await sleep(5);
    const second = client.get(API_ROUTES.users.summary);
    await sleep(5);
    releaseRefresh();
    await Promise.all([first, second]);

    const summaryCalls = calls.filter((c) => c.url.includes('/users/me/summary'));
    expect(summaryCalls).toHaveLength(1);
    expect(authHeader(summaryCalls[0])).toBe('Bearer access-new');
  });

  it('clears tokens and reports auth failure when the refresh token was reused', async () => {
    const tokens = memoryTokenStore(makeTokens('stolen'));
    const onAuthFailure = jest.fn();
    const { fetchFn } = scriptedFetch((call) => {
      if (call.url.endsWith(API_ROUTES.auth.refresh)) {
        return jsonResponse(401, { statusCode: 401, code: ErrorCode.REFRESH_TOKEN_REUSED, message: 'reused' });
      }
      return jsonResponse(401, { statusCode: 401, code: ErrorCode.TOKEN_EXPIRED, message: 'expired' });
    });
    const client = new ApiClient({ baseUrl: BASE, tokenStore: tokens, fetchFn, onAuthFailure });

    const error = await rejection(client.get(API_ROUTES.users.me));

    expect(error).toBeInstanceOf(ApiError);
    expect(error.statusCode).toBe(401);
    expect(tokens.current).toBeNull();
    expect(onAuthFailure).toHaveBeenCalledWith(ErrorCode.REFRESH_TOKEN_REUSED);
  });

  it('keeps tokens when the refresh itself fails for network reasons', async () => {
    const tokens = memoryTokenStore(makeTokens('keep'));
    const onAuthFailure = jest.fn();
    const { fetchFn } = scriptedFetch((call) => {
      if (call.url.endsWith(API_ROUTES.auth.refresh)) throw new TypeError('offline');
      return jsonResponse(401, { statusCode: 401, code: ErrorCode.TOKEN_EXPIRED, message: 'expired' });
    });
    const client = new ApiClient({ baseUrl: BASE, tokenStore: tokens, fetchFn, onAuthFailure });

    await expect(client.get(API_ROUTES.users.me)).rejects.toBeInstanceOf(ApiError);
    expect(tokens.current?.accessToken).toBe('access-keep');
    expect(onAuthFailure).not.toHaveBeenCalled();
  });

  it('notifies about blocked accounts on 403 with a blocking code', async () => {
    const tokens = memoryTokenStore(makeTokens('1'));
    const onAccountBlocked = jest.fn();
    const { fetchFn } = scriptedFetch(() =>
      jsonResponse(403, { statusCode: 403, code: ErrorCode.ACCOUNT_SUSPENDED, message: 'suspended' }),
    );
    const client = new ApiClient({ baseUrl: BASE, tokenStore: tokens, fetchFn, onAccountBlocked });

    await expect(client.get(API_ROUTES.ads.feed)).rejects.toMatchObject({ code: ErrorCode.ACCOUNT_SUSPENDED });
    expect(onAccountBlocked).toHaveBeenCalledWith(ErrorCode.ACCOUNT_SUSPENDED);
  });

  it('logout clears tokens first and posts the refresh token best-effort', async () => {
    const tokens = memoryTokenStore(makeTokens('bye'));
    const { fetchFn, calls } = scriptedFetch(() => jsonResponse(204, undefined));
    const client = new ApiClient({ baseUrl: BASE, tokenStore: tokens, fetchFn });

    await client.logout();

    expect(tokens.current).toBeNull();
    expect(calls[0].url).toBe(`${BASE}${API_BASE_PATH}${API_ROUTES.auth.logout}`);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ refreshToken: 'refresh-bye' });
    // F2: the access token travels as Bearer so the server can denylist it immediately.
    expect(authHeader(calls[0])).toBe('Bearer access-bye');
  });

  it('signs out when a freshly refreshed token is still rejected (denylisted access token)', async () => {
    const tokens = memoryTokenStore(makeTokens('old'));
    const onAuthFailure = jest.fn();
    const { fetchFn, calls } = scriptedFetch((call) => {
      if (call.url.endsWith(API_ROUTES.auth.refresh)) return jsonResponse(201, makeTokens('new'));
      return jsonResponse(401, { statusCode: 401, code: ErrorCode.INVALID_TOKEN, message: 'denylisted' });
    });
    const client = new ApiClient({ baseUrl: BASE, tokenStore: tokens, fetchFn, onAuthFailure });

    const error = await rejection(client.get(API_ROUTES.users.me));

    expect(error.code).toBe(ErrorCode.INVALID_TOKEN);
    // Exactly one refresh, exactly one retry - no loop.
    expect(calls.filter((c) => c.url.endsWith(API_ROUTES.auth.refresh))).toHaveLength(1);
    expect(calls.filter((c) => c.url.endsWith(API_ROUTES.users.me))).toHaveLength(2);
    expect(tokens.current).toBeNull();
    expect(onAuthFailure).toHaveBeenCalledWith(ErrorCode.INVALID_TOKEN);
  });

  it('sends extra headers such as Idempotency-Key and keeps them on the post-refresh retry', async () => {
    const tokens = memoryTokenStore(makeTokens('old'));
    const { fetchFn, calls } = scriptedFetch((call) => {
      if (call.url.endsWith(API_ROUTES.auth.refresh)) return jsonResponse(201, makeTokens('new'));
      if (authHeader(call) === 'Bearer access-old') {
        return jsonResponse(401, { statusCode: 401, code: ErrorCode.TOKEN_EXPIRED, message: 'expired' });
      }
      return jsonResponse(201, { id: 'w-1' });
    });
    const client = new ApiClient({ baseUrl: BASE, tokenStore: tokens, fetchFn });

    await client.post(API_ROUTES.withdrawals.create, { amountEtb: 50 }, { headers: { 'Idempotency-Key': 'intent-1' } });

    const posts = calls.filter((c) => c.url.endsWith(API_ROUTES.withdrawals.create));
    expect(posts).toHaveLength(2);
    for (const post of posts) {
      expect((post.init.headers as Record<string, string>)['Idempotency-Key']).toBe('intent-1');
      expect((post.init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    }
  });

  it('reports the kinds behind a 403 CONSENT_REQUIRED', async () => {
    const tokens = memoryTokenStore(makeTokens('1'));
    const onConsentRequired = jest.fn();
    const { fetchFn } = scriptedFetch(() =>
      jsonResponse(403, {
        statusCode: 403,
        code: ErrorCode.CONSENT_REQUIRED,
        message: 'accept first',
        details: { requiresConsent: ['terms', 'privacy'] },
      }),
    );
    const client = new ApiClient({ baseUrl: BASE, tokenStore: tokens, fetchFn, onConsentRequired });

    await expect(client.get(API_ROUTES.ads.feed)).rejects.toMatchObject({ code: ErrorCode.CONSENT_REQUIRED });
    expect(onConsentRequired).toHaveBeenCalledWith(['terms', 'privacy']);
    expect(tokens.current).not.toBeNull();
  });
});
