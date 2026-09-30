import { API_ROUTES } from '@rap/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { authStore } from '@/lib/api/auth-store';
import { acceptedConsentStateFixture, outdatedTermsProfileFixture, profileFixture, tokensFixture } from '@/test/mocks/fixtures';
import { url } from '@/test/mocks/handlers';
import { server } from '@/test/mocks/server';
import { renderWithApp } from '@/test/render';
import { SettingsPage } from './settings-page';

describe('SettingsPage (live endpoints)', { timeout: 20_000 }, () => {
  it('refreshes the cached profile from GET /advertisers/me', async () => {
    server.use(
      http.get(url(API_ROUTES.advertisers.me), () =>
        HttpResponse.json({ ...profileFixture, businessName: 'Habesha Coffee Roasters (renamed)' }),
      ),
      http.get(url(API_ROUTES.advertisers.consents), () => HttpResponse.json(acceptedConsentStateFixture)),
    );
    renderWithApp(<SettingsPage />, { authenticated: true, route: '/settings' });
    await waitFor(() =>
      expect(authStore.getState().session?.profile.businessName).toBe('Habesha Coffee Roasters (renamed)'),
    );
    expect(await screen.findByDisplayValue('Habesha Coffee Roasters (renamed)')).toBeInTheDocument();
  });

  it('saves business name and phone through PATCH /advertisers/me', async () => {
    let patched: Record<string, unknown> | null = null;
    server.use(
      http.get(url(API_ROUTES.advertisers.consents), () => HttpResponse.json(acceptedConsentStateFixture)),
      http.patch(url(API_ROUTES.advertisers.me), async ({ request }) => {
        patched = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...profileFixture, ...patched });
      }),
    );
    const user = userEvent.setup();
    renderWithApp(<SettingsPage />, { authenticated: true, route: '/settings' });
    const form = await screen.findByRole('form', { name: 'Business profile' });
    const name = within(form).getByLabelText(/Business name/);
    await user.clear(name);
    await user.type(name, 'Habesha Coffee PLC');
    const phone = within(form).getByLabelText(/Contact phone/);
    await user.clear(phone);
    await user.type(phone, '0911 222 333');
    await user.click(within(form).getByRole('button', { name: /Save changes/ }));

    await waitFor(() => expect(patched).toEqual({ businessName: 'Habesha Coffee PLC', contactPhone: '+251911222333' }));
    await waitFor(() => expect(authStore.getState().session?.profile.businessName).toBe('Habesha Coffee PLC'));
  });

  it('toggles a notification preference on the account', async () => {
    let patched: Record<string, unknown> | null = null;
    server.use(
      http.get(url(API_ROUTES.advertisers.consents), () => HttpResponse.json(acceptedConsentStateFixture)),
      http.patch(url(API_ROUTES.advertisers.me), async ({ request }) => {
        patched = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          ...profileFixture,
          notificationPrefs: { ...profileFixture.notificationPrefs, weeklyReport: false },
        });
      }),
    );
    const user = userEvent.setup();
    renderWithApp(<SettingsPage />, { authenticated: true, route: '/settings' });
    const toggle = await screen.findByRole('switch', { name: 'Weekly performance report' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.click(toggle);
    await waitFor(() => expect(patched).toEqual({ notificationPrefs: { weeklyReport: false } }));
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Weekly performance report' })).toHaveAttribute('aria-checked', 'false'),
    );
  });

  it('changes the password, then signs out because every session was revoked', async () => {
    let body: Record<string, unknown> | null = null;
    server.use(
      http.get(url(API_ROUTES.advertisers.consents), () => HttpResponse.json(acceptedConsentStateFixture)),
      http.post(url(API_ROUTES.auth.advertiserChangePassword), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ changed: true, sessionsRevoked: true }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    const { router } = renderWithApp(<SettingsPage />, {
      authenticated: true,
      route: '/settings',
      routes: [{ path: '/login', element: <h1>Login</h1> }],
    });
    const form = await screen.findByRole('form', { name: 'Change password' });
    await user.type(within(form).getByLabelText(/Current password/), 'Advertiser123!');
    await user.type(within(form).getByLabelText(/^New password/), 'Stronger456!');
    await user.type(within(form).getByLabelText(/Confirm new password/), 'Stronger456!');
    await user.click(within(form).getByRole('button', { name: /Change password/ }));

    await waitFor(() => expect(body).toEqual({ currentPassword: 'Advertiser123!', newPassword: 'Stronger456!' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(authStore.getState().status).toBe('anonymous');
  });

  it('shows the wrong-current-password error inline', async () => {
    server.use(http.get(url(API_ROUTES.advertisers.consents), () => HttpResponse.json(acceptedConsentStateFixture)));
    const user = userEvent.setup();
    renderWithApp(<SettingsPage />, { authenticated: true, route: '/settings' });
    const form = await screen.findByRole('form', { name: 'Change password' });
    await user.type(within(form).getByLabelText(/Current password/), 'nope-nope-1');
    await user.type(within(form).getByLabelText(/^New password/), 'Stronger456!');
    await user.type(within(form).getByLabelText(/Confirm new password/), 'Stronger456!');
    await user.click(within(form).getByRole('button', { name: /Change password/ }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Incorrect email or password');
    expect(authStore.getState().status).toBe('authenticated');
  });

  it('Legal card shows accepted vs current version and offers to accept when outdated', async () => {
    authStore.signIn(tokensFixture, outdatedTermsProfileFixture, true);
    server.use(http.get(url(API_ROUTES.advertisers.me), () => HttpResponse.json(outdatedTermsProfileFixture)));
    const user = userEvent.setup();
    renderWithApp(<SettingsPage />, { route: '/settings' });
    expect(await screen.findByTestId('accepted-terms-version')).toHaveTextContent('v1.0');
    expect(screen.getByTestId('current-terms-version')).toHaveTextContent('v1.1');
    expect(screen.getByText('Acceptance required')).toBeInTheDocument();
    // "Review and accept" appears in the gate-less settings card (the gate itself lives in the app shell).
    await user.click(screen.getByRole('button', { name: 'Review and accept' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('heading', { name: 'Gize Terms of Service (v1.1)' });
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: /Accept and continue/ }));
    await waitFor(() => expect(screen.getByTestId('accepted-terms-version')).toHaveTextContent('v1.1'));
    expect(screen.getByText('Up to date')).toBeInTheDocument();
  });
});
