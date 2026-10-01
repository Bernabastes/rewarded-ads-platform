import type { Request, Response } from 'express';
import { AUTH_MODE_COOKIE, AUTH_MODE_HEADER, REFRESH_COOKIE_NAME } from '@rap/shared';
import type { AppConfig } from '../../config/app-config';
import type { IssuedTokens } from './token.service';

export const COOKIE_MODE_VALUE: string = AUTH_MODE_COOKIE;
/** The cookie is only ever sent to the auth endpoints that need it (refresh / logout). */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

/**
 * Security audit #16: browser clients keep the refresh token in an httpOnly, Secure, SameSite=Strict cookie
 * instead of localStorage, so an XSS in the SPA cannot exfiltrate a long-lived credential. A client opts in per
 * request with `X-Auth-Mode: cookie` (or `?mode=cookie`); the mobile app keeps the body mode untouched.
 */
export function wantsCookieMode(req: Request): boolean {
  const header = req.headers[AUTH_MODE_HEADER.toLowerCase()];
  const value = Array.isArray(header) ? header[0] : header;
  if (value?.toLowerCase() === COOKIE_MODE_VALUE) return true;
  const q = (req.query as Record<string, unknown> | undefined)?.mode;
  return typeof q === 'string' && q.toLowerCase() === COOKIE_MODE_VALUE;
}

/** Minimal cookie-header parser (no cookie-parser dependency; we only ever read one cookie). */
export function readRefreshCookie(req: Request): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === REFRESH_COOKIE_NAME) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return part.slice(idx + 1).trim();
      }
    }
  }
  return undefined;
}

export function cookieOptions(config: AppConfig) {
  const e = config.env;
  return {
    httpOnly: true as const,
    // Secure by default except in plain-http local development (override with AUTH_COOKIE_SECURE).
    secure: e.AUTH_COOKIE_SECURE ?? !config.isDevelopment,
    sameSite: 'strict' as const,
    path: REFRESH_COOKIE_PATH,
    ...(e.AUTH_COOKIE_DOMAIN ? { domain: e.AUTH_COOKIE_DOMAIN } : {}),
  };
}

/**
 * In cookie mode: sets the refresh cookie and returns the token payload WITHOUT the refresh token
 * (the body must never carry it). In body mode: returns the tokens untouched.
 */
export function deliverTokens(req: Request, res: Response, config: AppConfig, tokens: IssuedTokens) {
  if (!wantsCookieMode(req)) return tokens;
  res.cookie(REFRESH_COOKIE_NAME, tokens.refreshToken, {
    ...cookieOptions(config),
    maxAge: config.env.JWT_REFRESH_TTL_DAYS * 86_400_000,
  });
  const { refreshToken: _omitted, ...rest } = tokens;
  void _omitted;
  return { ...rest, authMode: AUTH_MODE_COOKIE };
}

export function clearRefreshCookie(res: Response, config: AppConfig) {
  res.clearCookie(REFRESH_COOKIE_NAME, cookieOptions(config));
}
