import { REFRESH_COOKIE_NAME } from '@rap/shared';
import type { Request, Response } from 'express';
import { testConfig } from '../../testing/test-utils';
import { assertCookieModeOrigin, clearRefreshCookie, cookieOptions, deliverTokens, readRefreshCookie, REFRESH_COOKIE_PATH, wantsCookieMode } from './auth-cookies';

const tokens = { accessToken: 'a.b.c', refreshToken: 'r'.repeat(48), expiresIn: 900, tokenType: 'Bearer' as const };
const req = (over: Partial<Request> = {}) => ({ headers: {}, query: {}, ...over }) as unknown as Request;
const res = () => {
  const r = { cookie: jest.fn(), clearCookie: jest.fn() };
  return r as unknown as Response & typeof r;
};

describe('cookie-mode refresh tokens (security audit #16)', () => {
  it('body mode is the default: tokens are returned untouched and no cookie is set', () => {
    const r = res();
    expect(deliverTokens(req(), r, testConfig(), tokens)).toEqual(tokens);
    expect(r.cookie).not.toHaveBeenCalled();
  });

  it('X-Auth-Mode: cookie sets an httpOnly / SameSite=Strict cookie scoped to the auth path and strips the token from the body', () => {
    const r = res();
    const body = deliverTokens(req({ headers: { 'x-auth-mode': 'cookie' } }), r, testConfig({ NODE_ENV: 'test' }), tokens);
    expect(body).toEqual({ accessToken: 'a.b.c', expiresIn: 900, tokenType: 'Bearer', authMode: 'cookie' });
    expect(JSON.stringify(body)).not.toContain(tokens.refreshToken);
    expect(r.cookie).toHaveBeenCalledWith(
      REFRESH_COOKIE_NAME,
      tokens.refreshToken,
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'strict', path: REFRESH_COOKIE_PATH, maxAge: 30 * 86_400_000 }),
    );
    expect(wantsCookieMode(req({ headers: { 'x-auth-mode': 'body' } }))).toBe(false);
  });

  it('REGRESSION New-3: ?mode=cookie no longer selects cookie mode (a form POST cannot set the custom header)', () => {
    const r = res();
    expect(wantsCookieMode(req({ query: { mode: 'cookie' } }))).toBe(false);
    expect(deliverTokens(req({ query: { mode: 'cookie' } }), r, testConfig(), tokens)).toEqual(tokens);
    expect(r.cookie).not.toHaveBeenCalled();
  });

  it('New-3: cookie mode is refused for cross-site requests and unknown origins; own origins and non-browser clients pass', () => {
    const config = testConfig({ CORS_ORIGINS: 'https://admin.gize.app,https://ads.gize.app' });
    const cookieReq = (headers: Record<string, string>) => req({ headers: { 'x-auth-mode': 'cookie', ...headers } });
    // an attacker page: browsers always send Sec-Fetch-Site / Origin on a cross-site POST
    expect(() => assertCookieModeOrigin(cookieReq({ 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }), config)).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => assertCookieModeOrigin(cookieReq({ origin: 'https://evil.example' }), config)).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => assertCookieModeOrigin(cookieReq({ origin: 'null' }), config)).toThrow(expect.objectContaining({ status: 403 }));
    // our consoles
    expect(() => assertCookieModeOrigin(cookieReq({ 'sec-fetch-site': 'same-site', origin: 'https://admin.gize.app' }), config)).not.toThrow();
    expect(() => assertCookieModeOrigin(cookieReq({ origin: 'https://ADS.gize.app' }), config)).not.toThrow();
    // server-to-server / tests: no browser headers at all
    expect(() => assertCookieModeOrigin(cookieReq({}), config)).not.toThrow();
    // deliverTokens enforces it too (defence in depth): no cookie is set for a foreign origin
    const r = res();
    expect(() => deliverTokens(cookieReq({ origin: 'https://evil.example' }), r, config, tokens)).toThrow(expect.objectContaining({ status: 403 }));
    expect(r.cookie).not.toHaveBeenCalled();
  });

  it('Secure defaults to on except in plain-http development, and AUTH_COOKIE_SECURE / AUTH_COOKIE_DOMAIN override', () => {
    expect(cookieOptions(testConfig({ NODE_ENV: 'development' })).secure).toBe(false);
    expect(cookieOptions(testConfig({ NODE_ENV: 'test' })).secure).toBe(true);
    expect(cookieOptions(testConfig({ NODE_ENV: 'development', AUTH_COOKIE_SECURE: true })).secure).toBe(true);
    expect(cookieOptions(testConfig({ AUTH_COOKIE_DOMAIN: 'api.gize.et' })).domain).toBe('api.gize.et');
  });

  it('reads the refresh cookie out of a Cookie header and clears it with the same attributes', () => {
    expect(readRefreshCookie(req({ headers: { cookie: `theme=dark; ${REFRESH_COOKIE_NAME}=${encodeURIComponent('abc=/+')}; other=1` } }))).toBe('abc=/+');
    expect(readRefreshCookie(req({ headers: { cookie: 'theme=dark' } }))).toBeUndefined();
    expect(readRefreshCookie(req())).toBeUndefined();
    const r = res();
    clearRefreshCookie(r, testConfig());
    expect(r.clearCookie).toHaveBeenCalledWith(REFRESH_COOKIE_NAME, expect.objectContaining({ httpOnly: true, path: REFRESH_COOKIE_PATH }));
  });
});
