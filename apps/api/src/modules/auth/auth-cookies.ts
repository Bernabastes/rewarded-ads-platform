import type { Request, Response } from 'express';
import { AUTH_MODE_COOKIE, AUTH_MODE_HEADER, ErrorCode, REFRESH_COOKIE_NAME } from '@rap/shared';
import { AppException } from '../../common/errors/app.exception';
import type { AppConfig } from '../../config/app-config';
import type { IssuedTokens } from './token.service';

export const COOKIE_MODE_VALUE: string = AUTH_MODE_COOKIE;
/** The cookie is only ever sent to the auth endpoints that need it (refresh / logout). */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

/**
 * Security audit #16: browser clients keep the refresh token in an httpOnly, Secure, SameSite=Strict cookie
 * instead of localStorage, so an XSS in the SPA cannot exfiltrate a long-lived credential. A client opts in per
 * request with the `X-Auth-Mode: cookie` header ONLY (Phase 5b New-3: a custom header forces a CORS preflight, so
 * a cross-site HTML form can never select cookie mode - the former `?mode=cookie` query switch is gone); the
 * mobile app keeps the body mode untouched.
 */
export function wantsCookieMode(req: Request): boolean {
  const header = req.headers[AUTH_MODE_HEADER.toLowerCase()];
  const value = Array.isArray(header) ? header[0] : header;
  return value?.toLowerCase() === COOKIE_MODE_VALUE;
}

/**
 * Phase 5b New-3 (login CSRF): a cookie-mode auth request must come from one of our own origins. Browsers always
 * send `Origin` on cross-origin POSTs and `Sec-Fetch-Site` on every request; a cross-site value or an origin that
 * is not in the CORS allow-list is refused (403) before any cookie is set or read. Requests without either header
 * (server-to-server, tests) are not browser-forgeable and pass.
 */
export function assertCookieModeOrigin(req: Request, config: AppConfig): void {
  const fetchSite = headerValue(req, 'sec-fetch-site');
  if (fetchSite && fetchSite.toLowerCase() === 'cross-site') {
    throw AppException.forbidden(ErrorCode.FORBIDDEN, 'Cookie-mode authentication is not available to cross-site requests');
  }
  const origin = headerValue(req, 'origin');
  if (!origin || origin === 'null') {
    if (origin === 'null') throw AppException.forbidden(ErrorCode.FORBIDDEN, 'Cookie-mode authentication requires a known origin');
    return;
  }
  const allowed = config.corsOrigins;
  if (allowed.includes('*') || allowed.some((o) => o.toLowerCase() === origin.toLowerCase())) return;
  throw AppException.forbidden(ErrorCode.FORBIDDEN, 'Cookie-mode authentication is not available to this origin');
}

function headerValue(req: Request, name: string): string | undefined {
  const raw = req.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.trim() || undefined;
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
    // AUTH_COOKIE_DOMAIN should stay unset: a host-only cookie cannot be planted by (or leak to) sibling subdomains.
    ...(e.AUTH_COOKIE_DOMAIN ? { domain: e.AUTH_COOKIE_DOMAIN } : {}),
  };
}

/**
 * In cookie mode: checks the request origin (New-3), sets the refresh cookie and returns the token payload WITHOUT
 * the refresh token (the body must never carry it). In body mode: returns the tokens untouched.
 */
export function deliverTokens(req: Request, res: Response, config: AppConfig, tokens: IssuedTokens) {
  if (!wantsCookieMode(req)) return tokens;
  assertCookieModeOrigin(req, config);
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
