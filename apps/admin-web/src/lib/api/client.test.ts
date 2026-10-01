import { describe, expect, it, vi } from 'vitest';
import { ApiClient, buildQuery } from './client';
import { ApiError } from './errors';
import { createTokenStore } from './token-store';

const BASE = 'http://api.test/api/v1';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function makeStore(expiresInSeconds = 900) {
  const store = createTokenStore(null);
  store.set({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: expiresInSeconds, tokenType: 'Bearer' });
  return store;
}

/** A scripted fetch: each call pops the next handler; handlers receive (url, init). */
function scriptedFetch(handlers: Array<(url: string, init: RequestInit) => Response | Promise<Response>>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    const handler = handlers.shift();
    if (!handler) throw new Error(`unexpected fetch ${url}`);
    return handler(url, init ?? {});
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const authHeader = (init: RequestInit) => (init.headers as Record<string, string>).authorization;

describe('buildQuery', () => {
  it('skips null/undefined but keeps empty strings (needed for the resolved= workaround)', () => {
    expect(buildQuery({ a: 1, b: undefined, c: null, d: '', e: false, f: 'x y' })).toBe('?a=1&d=&e=false&f=x+y');
    expect(buildQuery({})).toBe('');
    expect(buildQuery(undefined)).toBe('');
  });
});

describe('ApiClient', () => {
  it('attaches the bearer token and parses JSON', async () => {
    const store = makeStore();
    const { fetchImpl, calls } = scriptedFetch([() => jsonResponse({ ok: true })]);
    const client = new ApiClient({ baseUrl: BASE, tokens: store, fetch: fetchImpl });
    await expect(client.get('/admin/me')).resolves.toEqual({ ok: true });
    expect(calls[0]!.url).toBe(`${BASE}/admin/me`);
    expect(authHeader(calls[0]!.init)).toBe('Bearer access-1');
  });

  it('returns undefined for 204 responses', async () => {
    const store = makeStore();
    const { fetchImpl } = scriptedFetch([() => new Response(null, { status: 204 })]);
    const client = new ApiClient({ baseUrl: BASE, tokens: store, fetch: fetchImpl });
    await expect(client.post('/auth/logout', { refreshToken: 'x' }, { anonymous: true })).resolves.toBeUndefined();
  });

  it('throws ApiError with the server envelope on non-2xx', async () => {
    const store = makeStore();
    const { fetchImpl } = scriptedFetch([() => jsonResponse({ statusCode: 403, code: 'ROLE_NOT_ALLOWED', message: 'nope', details: { requiredRoles: ['finance'] } }, 403)]);
    const client = new ApiClient({ baseUrl: BASE, tokens: store, fetch: fetchImpl });
    const err = await client.get('/admin/withdrawals').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('ROLE_NOT_ALLOWED');
    expect((err as ApiError).status).toBe(403);
    expect((err as ApiError).requiredRoles).toEqual(['finance']);
  });

  it('refreshes once on 401 TOKEN_EXPIRED and retries the original request with the new token', async () => {
    const store = makeStore();
    const { fetchImpl, calls } = scriptedFetch([
      () => jsonResponse({ statusCode: 401, code: 'TOKEN_EXPIRED', message: 'expired' }, 401),
      () => jsonResponse({ accessToken: 'access-2', refreshToken: 'refresh-2', expiresIn: 900, tokenType: 'Bearer' }, 201),
      () => jsonResponse({ id: 'me' }),
    ]);
    const client = new ApiClient({ baseUrl: BASE, tokens: store, fetch: fetchImpl });
    await expect(client.get('/admin/me')).resolves.toEqual({ id: 'me' });
    expect(calls.map((c) => c.url)).toEqual([`${BASE}/admin/me`, `${BASE}/auth/refresh`, `${BASE}/admin/me`]);
    // Security audit #16: cookie mode - no refresh token in the body, the httpOnly cookie travels with credentials
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({});
    expect((calls[1]!.init.headers as Record<string, string>)['X-Auth-Mode']).toBe('cookie');
    expect(calls[1]!.init.credentials).toBe('include');
    expect(authHeader(calls[2]!.init)).toBe('Bearer access-2');
    expect(store.get()?.accessToken).toBe('access-2');
    expect(store.get()?.refreshToken ?? null).toBeNull();
  });

  it('shares a single in-flight refresh between concurrent 401s and queues the retries', async () => {
    const store = makeStore();
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((r) => (releaseRefresh = r));
    const { fetchImpl, calls } = scriptedFetch([
      () => jsonResponse({ statusCode: 401, code: 'TOKEN_EXPIRED', message: 'expired' }, 401),
      () => jsonResponse({ statusCode: 401, code: 'TOKEN_EXPIRED', message: 'expired' }, 401),
      async () => {
        await refreshGate;
        return jsonResponse({ accessToken: 'access-2', refreshToken: 'refresh-2', expiresIn: 900, tokenType: 'Bearer' }, 201);
      },
      (url) => jsonResponse({ url }),
      (url) => jsonResponse({ url }),
    ]);
    const client = new ApiClient({ baseUrl: BASE, tokens: store, fetch: fetchImpl });
    const p1 = client.get<{ url: string }>('/a');
    const p2 = client.get<{ url: string }>('/b');
    await vi.waitFor(() => expect(calls.length).toBe(3));
    releaseRefresh();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(new Set([r1.url, r2.url])).toEqual(new Set([`${BASE}/a`, `${BASE}/b`]));
    const refreshCalls = calls.filter((c) => c.url.endsWith('/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
    expect(calls.slice(3).every((c) => authHeader(c.init) === 'Bearer access-2')).toBe(true);
  });

  it('clears tokens and reports auth loss when the refresh token was reused/revoked', async () => {
    const store = makeStore();
    const onAuthLost = vi.fn();
    const { fetchImpl } = scriptedFetch([
      () => jsonResponse({ statusCode: 401, code: 'TOKEN_EXPIRED', message: 'expired' }, 401),
      () => jsonResponse({ statusCode: 401, code: 'REFRESH_TOKEN_REUSED', message: 'reuse' }, 401),
    ]);
    const client = new ApiClient({ baseUrl: BASE, tokens: store, fetch: fetchImpl, onAuthLost });
    const err = await client.get('/admin/me').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('TOKEN_EXPIRED');
    expect(store.get()).toBeNull();
    expect(onAuthLost).toHaveBeenCalledWith('refresh_failed');
  });

  it('logs out on 401 with a non-expiry code (invalid / revoked access token)', async () => {
    const store = makeStore();
    const onAuthLost = vi.fn();
    const { fetchImpl, calls } = scriptedFetch([() => jsonResponse({ statusCode: 401, code: 'INVALID_TOKEN', message: 'bad' }, 401)]);
    const client = new ApiClient({ baseUrl: BASE, tokens: store, fetch: fetchImpl, onAuthLost });
    await expect(client.get('/admin/me')).rejects.toBeInstanceOf(ApiError);
    expect(calls).toHaveLength(1);
    expect(store.get()).toBeNull();
    expect(onAuthLost).toHaveBeenCalledWith('unauthorized');
  });

  it('refreshes proactively when the access token is about to expire', async () => {
    const store = makeStore(5); // expires in 5s < 20s skew
    const { fetchImpl, calls } = scriptedFetch([
      () => jsonResponse({ accessToken: 'access-2', refreshToken: 'refresh-2', expiresIn: 900, tokenType: 'Bearer' }, 201),
      () => jsonResponse({ ok: true }),
    ]);
    const client = new ApiClient({ baseUrl: BASE, tokens: store, fetch: fetchImpl });
    await client.get('/admin/overview');
    expect(calls[0]!.url).toBe(`${BASE}/auth/refresh`);
    expect(authHeader(calls[1]!.init)).toBe('Bearer access-2');
  });

  it('does not touch credentials for anonymous requests (login) and surfaces 401 as-is', async () => {
    const store = makeStore();
    const onAuthLost = vi.fn();
    const { fetchImpl, calls } = scriptedFetch([() => jsonResponse({ statusCode: 401, code: 'INVALID_CREDENTIALS', message: 'no' }, 401)]);
    const client = new ApiClient({ baseUrl: BASE, tokens: store, fetch: fetchImpl, onAuthLost });
    const err = await client.post('/auth/admin/login', { email: 'a', password: 'b' }, { anonymous: true }).catch((e: unknown) => e);
    expect((err as ApiError).code).toBe('INVALID_CREDENTIALS');
    expect(authHeader(calls[0]!.init)).toBeUndefined();
    expect(onAuthLost).not.toHaveBeenCalled();
    expect(store.get()?.accessToken).toBe('access-1');
  });

  it('converts network failures into a NETWORK_ERROR ApiError without dropping the session', async () => {
    const store = makeStore();
    const { fetchImpl } = scriptedFetch([
      () => {
        throw new TypeError('Failed to fetch');
      },
    ]);
    const client = new ApiClient({ baseUrl: BASE, tokens: store, fetch: fetchImpl });
    const err = await client.get('/admin/me').catch((e: unknown) => e);
    expect((err as ApiError).isNetwork).toBe(true);
    expect(store.get()?.accessToken).toBe('access-1');
  });
});
