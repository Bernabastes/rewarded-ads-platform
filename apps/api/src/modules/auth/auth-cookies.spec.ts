import { REFRESH_COOKIE_NAME } from '@rap/shared';
import type { Request, Response } from 'express';
import { testConfig } from '../../testing/test-utils';
import { clearRefreshCookie, cookieOptions, deliverTokens, readRefreshCookie, REFRESH_COOKIE_PATH, wantsCookieMode } from './auth-cookies';

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

  it('X-Auth-Mode: cookie (or ?mode=cookie) sets an httpOnly / SameSite=Strict cookie scoped to the auth path and strips the token from the body', () => {
    const r = res();
    const body = deliverTokens(req({ headers: { 'x-auth-mode': 'cookie' } }), r, testConfig({ NODE_ENV: 'test' }), tokens);
    expect(body).toEqual({ accessToken: 'a.b.c', expiresIn: 900, tokenType: 'Bearer', authMode: 'cookie' });
    expect(JSON.stringify(body)).not.toContain(tokens.refreshToken);
    expect(r.cookie).toHaveBeenCalledWith(
      REFRESH_COOKIE_NAME,
      tokens.refreshToken,
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'strict', path: REFRESH_COOKIE_PATH, maxAge: 30 * 86_400_000 }),
    );
    expect(wantsCookieMode(req({ query: { mode: 'cookie' } }))).toBe(true);
    expect(wantsCookieMode(req({ headers: { 'x-auth-mode': 'body' } }))).toBe(false);
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
