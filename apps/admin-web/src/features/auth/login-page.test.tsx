import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { authStore, tokenStore } from '@/lib/api/api';
import { adminReviewer, BASE, tokens } from '@/test/msw/fixtures';
import { server } from '@/test/msw/server';
import { renderWithProviders } from '@/test/utils';
import { LoginPage } from './login-page';

describe('LoginPage', () => {
  it('validates the form before hitting the API', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />, { admin: null, route: '/login' });
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText('Email is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
  });

  it('shows an inline error for INVALID_CREDENTIALS without touching the session', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />, { admin: null, route: '/login' });
    await user.type(screen.getByLabelText(/email/i), 'super@rap.et');
    await user.type(screen.getByLabelText(/^password/i), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText('Incorrect email or password.')).toBeInTheDocument();
    expect(authStore.getState().status).toBe('anonymous');
    expect(tokenStore.get()).toBeNull();
  });

  it('stores tokens and loads /admin/me (role source of truth) on success', async () => {
    server.use(
      http.post(`${BASE}/auth/admin/login`, () => HttpResponse.json({ tokens: tokens('login'), admin: { ...adminReviewer, permissions: undefined } }, { status: 201 })),
      http.get(`${BASE}/admin/me`, ({ request }) => {
        if (request.headers.get('authorization') !== 'Bearer access-login') return HttpResponse.json({ statusCode: 401, code: 'UNAUTHORIZED', message: 'no' }, { status: 401 });
        return HttpResponse.json(adminReviewer);
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />, { admin: null, route: '/login' });
    await user.type(screen.getByLabelText(/email/i), 'reviewer@rap.et');
    await user.type(screen.getByLabelText(/^password/i), 'Admin123!');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(authStore.getState().status).toBe('authenticated'));
    expect(authStore.getState().admin?.role).toBe('ad_reviewer');
    expect(authStore.getState().admin?.permissions).toContain('ads.review');
    expect(tokenStore.get()?.refreshToken).toBe('refresh-login');
  });

  it('explains why the previous session ended', async () => {
    renderWithProviders(<LoginPage />, { admin: null, route: '/login' });
    await act(async () => authStore.setState({ lastLogoutReason: 'revoked' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/signed out for security reasons/i);
  });

  describe('Phase 5 (#5): lockout + MFA second step', () => {
    it('shows the lockout message for 423 ACCOUNT_LOCKED with the retry hint', async () => {
      server.use(
        http.post(`${BASE}/auth/admin/login`, () =>
          HttpResponse.json({ statusCode: 423, code: 'ACCOUNT_LOCKED', message: 'locked', details: { retryAfterSeconds: 600 } }, { status: 423 }),
        ),
      );
      const user = userEvent.setup();
      renderWithProviders(<LoginPage />, { admin: null, route: '/login' });
      await user.type(screen.getByLabelText(/email/i), 'super@rap.et');
      await user.type(screen.getByLabelText(/^password/i), 'Admin123!');
      await user.click(screen.getByRole('button', { name: /sign in/i }));
      expect(await screen.findByRole('alert')).toHaveTextContent(/temporarily locked.*10 min/i);
      expect(authStore.getState().status).toBe('anonymous');
    });

    it('switches to the code step on { mfaRequired } and completes the login via /auth/admin/login/mfa', async () => {
      let mfaBody: unknown;
      server.use(
        http.post(`${BASE}/auth/admin/login`, () => HttpResponse.json({ mfaRequired: true, mfaToken: 'mfa-token-1', expiresIn: 300 }, { status: 201 })),
        http.post(`${BASE}/auth/admin/login/mfa`, async ({ request }) => {
          mfaBody = await request.json();
          if ((mfaBody as { code: string }).code !== '246810') {
            return HttpResponse.json({ statusCode: 400, code: 'MFA_CODE_INVALID', message: 'bad' }, { status: 400 });
          }
          return HttpResponse.json({ tokens: tokens('mfa'), admin: { ...adminReviewer, mfaEnabled: true } }, { status: 201 });
        }),
        http.get(`${BASE}/admin/me`, () => HttpResponse.json({ ...adminReviewer, mfaEnabled: true })),
      );
      const user = userEvent.setup();
      renderWithProviders(<LoginPage />, { admin: null, route: '/login' });
      await user.type(screen.getByLabelText(/email/i), 'reviewer@rap.et');
      await user.type(screen.getByLabelText(/^password/i), 'Admin123!');
      await user.click(screen.getByRole('button', { name: /sign in/i }));

      expect(await screen.findByTestId('mfa-form')).toBeInTheDocument();
      expect(screen.getByText(/two-factor verification/i)).toBeInTheDocument();
      expect(tokenStore.get()).toBeNull(); // nothing issued yet

      await user.type(screen.getByLabelText(/verification code/i), '111111');
      await user.click(screen.getByRole('button', { name: /verify & sign in/i }));
      expect(await screen.findByText(/that code is not valid/i)).toBeInTheDocument();

      await user.clear(screen.getByLabelText(/verification code/i));
      await user.type(screen.getByLabelText(/verification code/i), '246810');
      await user.click(screen.getByRole('button', { name: /verify & sign in/i }));
      await waitFor(() => expect(authStore.getState().status).toBe('authenticated'));
      expect(mfaBody).toEqual({ mfaToken: 'mfa-token-1', code: '246810' });
      expect(tokenStore.get()?.refreshToken).toBe('refresh-mfa');
      expect(authStore.getState().admin?.mfaEnabled).toBe(true);
    });
  });
});
