import type { NextFunction, Request, Response } from 'express';
import { flattenValidationErrors, mediaTypeOf, rejectNonJsonAuthBodies } from './app.setup';

/**
 * Phase 5b New-3 (login CSRF): an HTML form can POST `application/x-www-form-urlencoded`, `multipart/form-data` or
 * `text/plain` cross-site without a preflight. The auth endpoints answer 415 to anything that is not JSON.
 */
describe('rejectNonJsonAuthBodies (Phase 5b New-3)', () => {
  const run = (method: string, path: string, headers: Record<string, string>) => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response & { status: jest.Mock; json: jest.Mock };
    const next = jest.fn() as unknown as NextFunction & jest.Mock;
    rejectNonJsonAuthBodies({ method, path, headers } as unknown as Request, res, next);
    return { res, next };
  };

  it.each(['application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'text/plain'])(
    'REGRESSION: a form POST with %s to /auth/* is refused with 415 before routing',
    (contentType) => {
      const { res, next } = run('POST', '/api/v1/auth/advertiser/login', { 'content-type': contentType, 'content-length': '42' });
      expect(res.status).toHaveBeenCalledWith(415);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 415 }));
      expect(next).not.toHaveBeenCalled();
    },
  );

  it.each(['TEXT/PLAIN; charset=utf-8', 'multipart/mixed', 'Multipart/Form-Data; boundary=----x', 'application/json-patch+json', 'application/x-www-form-urlencoded; charset=UTF-8'])(
    'Phase 5c: %s (JSON text in a non-JSON envelope, mixed case, parameters) is still 415',
    (contentType) => {
      const { res, next } = run('POST', '/api/v1/auth/otp/verify', { 'content-type': contentType, 'transfer-encoding': 'chunked' });
      expect(res.status).toHaveBeenCalledWith(415);
      expect(next).not.toHaveBeenCalled();
    },
  );

  it.each(['application/json', 'APPLICATION/JSON', 'application/json; charset=utf-8', ' Application/Json ;charset=UTF-8'])(
    'Phase 5c: %s is accepted (case-insensitive, parameter-tolerant)',
    (contentType) => {
      expect(run('POST', '/api/v1/auth/admin/login', { 'content-type': contentType, 'content-length': '42' }).next).toHaveBeenCalled();
    },
  );

  it('mediaTypeOf normalises the header', () => {
    expect(mediaTypeOf(' APPLICATION/JSON ; charset=utf-8')).toBe('application/json');
    expect(mediaTypeOf(undefined)).toBe('');
  });

  it('lets JSON bodies, body-less requests and non-auth routes through', () => {
    expect(run('POST', '/api/v1/auth/admin/login', { 'content-type': 'application/json; charset=utf-8', 'content-length': '42' }).next).toHaveBeenCalled();
    expect(run('POST', '/api/v1/auth/logout', {}).next).toHaveBeenCalled();
    expect(run('GET', '/api/v1/auth/me', { 'content-type': 'text/plain' }).next).toHaveBeenCalled();
    expect(run('POST', '/api/v1/billing/webhooks/chapa', { 'content-type': 'application/x-www-form-urlencoded', 'content-length': '9' }).next).toHaveBeenCalled();
    expect(run('POST', '/api/v1/authors', { 'content-type': 'text/plain', 'content-length': '9' }).next).toHaveBeenCalled();
  });
});

describe('flattenValidationErrors', () => {
  it('flattens nested class-validator errors into field paths', () => {
    expect(
      flattenValidationErrors([
        { property: 'email', constraints: { isEmail: 'email must be an email' } },
        { property: 'address', children: [{ property: 'city', constraints: { isString: 'city must be a string' } }] },
      ]),
    ).toEqual([
      { field: 'email', messages: ['email must be an email'] },
      { field: 'address.city', messages: ['city must be a string'] },
    ]);
  });
});
