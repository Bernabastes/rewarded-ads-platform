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
});
