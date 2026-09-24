import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { authStore } from '@/lib/api/auth-store';
import { renderWithApp } from '@/test/render';
import { LoginPage } from './login-page';

describe('LoginPage', () => {
  it('validates before hitting the API', async () => {
    const user = userEvent.setup();
    renderWithApp(<LoginPage />, { route: '/login' });
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(authStore.getState().status).toBe('anonymous');
  });

  it('shows a friendly message for invalid credentials keyed on the error code', async () => {
    const user = userEvent.setup();
    renderWithApp(<LoginPage />, { route: '/login' });
    await user.type(screen.getByLabelText(/Work email/), 'ads@habesha-coffee.et');
    await user.type(screen.getByLabelText(/^Password/), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password');
    expect(authStore.getState().status).toBe('anonymous');
  });

  it('signs in, stores the session and redirects home', async () => {
    const user = userEvent.setup();
    const { router } = renderWithApp(<LoginPage />, {
      route: '/login',
      routes: [{ path: '/', element: <h1>Dashboard home</h1> }],
    });
    await user.type(screen.getByLabelText(/Work email/), 'ads@habesha-coffee.et');
    await user.type(screen.getByLabelText(/^Password/), 'Advertiser123!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(authStore.getState().status).toBe('authenticated');
    expect(authStore.getState().session?.profile.businessName).toBe('Habesha Coffee Roasters PLC');
    expect(window.localStorage.getItem('gize.auth.session')).toContain('access-token-1');
  });

  it('keeps the session in sessionStorage when "keep me signed in" is off', async () => {
    const user = userEvent.setup();
    renderWithApp(<LoginPage />, { route: '/login', routes: [{ path: '/', element: <h1>Home</h1> }] });
    await user.type(screen.getByLabelText(/Work email/), 'ads@habesha-coffee.et');
    await user.type(screen.getByLabelText(/^Password/), 'Advertiser123!');
    await user.click(screen.getByRole('checkbox', { name: /Keep me signed in/ }));
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(authStore.getState().status).toBe('authenticated'));
    expect(window.localStorage.getItem('gize.auth.session')).toBeNull();
    expect(window.sessionStorage.getItem('gize.auth.session')).toContain('access-token-1');
  });
});
