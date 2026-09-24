import { ErrorCode, type AuthTokens } from '@rap/shared';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient, buildQuery, type TokenStore } from './client';
import { ApiError, ClientErrorCode } from './errors';

const BASE = 'http://api.test/api/v1';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function envelope(status: number, code: string, message = code) {
  return json({ statusCode: status, code, message }, status);
}

function makeTokens(suffix: string): AuthTokens {
  return {
    accessToken: `access-${suffix}`,
    refreshToken: `refresh-${suffix}`,
    expiresIn: 900,
    tokenType: 'Bearer',
  };
}

function makeStore(initial: AuthTokens | null, expiry: number | null = null) {
  let tokens = initial;
  const store: TokenStore & { expired: string[] } = {
    expired: [],
    get: () => tokens,
    set: (next) => {
      tokens = next;
    },
    expire: (reason) => {
      tokens = null;
      store.expired.push(reason);
    },
    getAccessTokenExpiry: () => expiry,
  };
  return store;
}

describe('buildQuery', () => {
  it('serialises defined params and skips empty ones', () => {
    expect(buildQuery({ page: 2, limit: 20, status: undefined, q: '', flag: false })).toBe(
      '?page=2&limit=20&flag=false',
    );
    expect(buildQuery()).toBe('');
  });
});

describe('ApiClient', () => {
  it('attaches the bearer token and parses JSON', async () => {
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1');
      return json({ ok: true });
    });
    const client = new ApiClient({
      baseUrl: BASE,
      tokens: makeStore(makeTokens('1')),
      fetchFn: fetchFn as typeof fetch,
    });
    await expect(client.get('/campaigns')).resolves.toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledWith(`${BASE}/campaigns`, expect.anything());
  });

  it('throws an ApiError carrying the envelope code and validation details', async () => {
    const fetchFn = vi.fn(async () =>
      json(
        {
          statusCode: 400,
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Validation failed',
          details: [{ field: 'title', messages: ['too short'] }],
        },
        400,
      ),
    );
    const client = new ApiClient({
      baseUrl: BASE,
      tokens: makeStore(makeTokens('1')),
      fetchFn: fetchFn as typeof fetch,
    });
    const error = await client.post('/campaigns', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe(ErrorCode.VALIDATION_ERROR);
    expect((error as ApiError).validationDetails).toEqual([{ field: 'title', messages: ['too short'] }]);
  });

  it('refreshes once on 401 TOKEN_EXPIRED and retries with the new token', async () => {
    const store = makeStore(makeTokens('old'));
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get('Authorization');
      calls.push(`${init?.method} ${String(url).replace(BASE, '')} ${auth}`);
      if (String(url).endsWith('/auth/refresh')) {
        expect(JSON.parse(String(init?.body))).toEqual({ refreshToken: 'refresh-old' });
        return json(makeTokens('new'));
      }
      if (auth === 'Bearer access-old') return envelope(401, ErrorCode.TOKEN_EXPIRED);
      return json({ data: 'fresh' });
    });
    const client = new ApiClient({ baseUrl: BASE, tokens: store, fetchFn: fetchFn as typeof fetch });

    await expect(client.get('/billing/balance')).resolves.toEqual({ data: 'fresh' });
    expect(store.get()?.accessToken).toBe('access-new');
    expect(calls).toEqual([
      'GET /billing/balance Bearer access-old',
      'POST /auth/refresh null',
      'GET /billing/balance Bearer access-new',
    ]);
  });

  it('shares a single in-flight refresh between concurrent 401s and retries all of them', async () => {
    const store = makeStore(makeTokens('old'));
    let refreshCalls = 0;
    let releaseRefresh: (() => void) | null = null;
    const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get('Authorization');
      if (String(url).endsWith('/auth/refresh')) {
        refreshCalls += 1;
        await new Promise<void>((resolve) => {
          releaseRefresh = resolve;
        });
        return json(makeTokens('new'));
      }
      if (auth === 'Bearer access-old') return envelope(401, ErrorCode.TOKEN_EXPIRED);
      return json({ path: String(url).replace(BASE, '') });
    });
    const client = new ApiClient({ baseUrl: BASE, tokens: store, fetchFn: fetchFn as typeof fetch });

    const pending = Promise.all([client.get('/a'), client.get('/b'), client.get('/c')]);
    // Let the three initial 401s land and the single refresh start.
    await vi.waitFor(() => expect(refreshCalls).toBe(1));
    releaseRefresh!();

    await expect(pending).resolves.toEqual([{ path: '/a' }, { path: '/b' }, { path: '/c' }]);
    expect(refreshCalls).toBe(1);
    // 3 originals + 1 refresh + 3 retries
    expect(fetchFn).toHaveBeenCalledTimes(7);
  });

  it('expires the session when the refresh token was reused (theft detection) and rethrows the original error', async () => {
    const store = makeStore(makeTokens('old'));
    const fetchFn = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/auth/refresh')) return envelope(401, ErrorCode.REFRESH_TOKEN_REUSED);
      return envelope(401, ErrorCode.TOKEN_EXPIRED);
    });
    const client = new ApiClient({ baseUrl: BASE, tokens: store, fetchFn: fetchFn as typeof fetch });

    const error = await client.get('/campaigns').catch((e: unknown) => e);
    expect((error as ApiError).code).toBe(ErrorCode.TOKEN_EXPIRED);
    expect(store.get()).toBeNull();
    expect(store.expired).toEqual([ErrorCode.REFRESH_TOKEN_REUSED]);
  });

  it('logs out immediately when there is no refresh token to use', async () => {
    const store = makeStore({ ...makeTokens('x'), refreshToken: '' });
    const fetchFn = vi.fn(async () => envelope(401, ErrorCode.UNAUTHORIZED));
    const client = new ApiClient({ baseUrl: BASE, tokens: store, fetchFn: fetchFn as typeof fetch });
    await expect(client.get('/campaigns')).rejects.toMatchObject({ code: ErrorCode.UNAUTHORIZED });
    expect(store.expired).toEqual([ErrorCode.UNAUTHORIZED]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('refreshes proactively when the access token is about to expire', async () => {
    const now = 1_000_000;
    const store = makeStore(makeTokens('old'), now + 5_000);
    const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith('/auth/refresh')) return json(makeTokens('new'));
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-new');
      return json({ ok: true });
    });
    const client = new ApiClient({
      baseUrl: BASE,
      tokens: store,
      fetchFn: fetchFn as typeof fetch,
      now: () => now,
      refreshLeewayMs: 20_000,
    });
    await expect(client.get('/campaigns')).resolves.toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('does not attach auth or refresh for public requests', async () => {
    const store = makeStore(makeTokens('old'));
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Authorization')).toBeNull();
      return envelope(401, ErrorCode.INVALID_CREDENTIALS);
    });
    const client = new ApiClient({ baseUrl: BASE, tokens: store, fetchFn: fetchFn as typeof fetch });
    await expect(
      client.post('/auth/advertiser/login', { email: 'x', password: 'y' }, { auth: false }),
    ).rejects.toMatchObject({
      code: ErrorCode.INVALID_CREDENTIALS,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(store.get()?.accessToken).toBe('access-old');
  });

  it('maps network failures to NETWORK_ERROR and 204 to undefined', async () => {
    const store = makeStore(makeTokens('old'));
    const failing = new ApiClient({
      baseUrl: BASE,
      tokens: store,
      fetchFn: (async () => {
        throw new TypeError('Failed to fetch');
      }) as typeof fetch,
    });
    await expect(failing.get('/campaigns')).rejects.toMatchObject({
      code: ClientErrorCode.NETWORK_ERROR,
      statusCode: 0,
    });

    const ok = new ApiClient({
      baseUrl: BASE,
      tokens: store,
      fetchFn: (async () => new Response(null, { status: 204 })) as typeof fetch,
    });
    await expect(ok.delete('/campaigns/1')).resolves.toBeUndefined();
  });
});
