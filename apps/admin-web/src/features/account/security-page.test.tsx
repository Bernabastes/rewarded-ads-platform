import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { authStore } from '@/lib/api/api';
import { adminFinance, BASE } from '@/test/msw/fixtures';
import { server } from '@/test/msw/server';
import { renderWithProviders } from '@/test/utils';
import { SecurityPage } from './security-page';

describe('SecurityPage (Phase 5 #5)', () => {
  it('shows the pending banner for a temporary password and changes it (then signs out every session)', async () => {
    const user = userEvent.setup();
    let body: unknown;
    server.use(
      http.post(`${BASE}/admin/me/change-password`, async ({ request }) => {
        body = await request.json();
        if ((body as { currentPassword: string }).currentPassword !== 'Temp1234') {
          return HttpResponse.json({ statusCode: 401, code: 'INVALID_CREDENTIALS', message: 'x' }, { status: 401 });
        }
        return HttpResponse.json({ changed: true, sessionsRevoked: true });
      }),
      http.post(`${BASE}/auth/logout`, () => new HttpResponse(null, { status: 204 })),
    );
    renderWithProviders(<SecurityPage />, { admin: { ...adminFinance, mustChangePassword: true }, route: '/account/security' });
    expect(await screen.findByTestId('pending-security-banner')).toHaveTextContent(/temporary password/i);

    await user.type(screen.getByLabelText(/temporary password/i), 'wrong-temp');
    await user.type(screen.getByLabelText(/^new password/i), 'NewPassw0rd!');
    await user.type(screen.getByLabelText(/confirm new password/i), 'NewPassw0rd!');
    await user.click(screen.getByTestId('change-password-submit'));
    expect(await screen.findByText('Current password is incorrect.')).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/temporary password/i));
    await user.type(screen.getByLabelText(/temporary password/i), 'Temp1234');
    await user.click(screen.getByTestId('change-password-submit'));
    await waitFor(() => expect(body).toEqual({ currentPassword: 'Temp1234', newPassword: 'NewPassw0rd!' }));
    expect(await screen.findByText('Password changed')).toBeInTheDocument();
    await waitFor(() => expect(authStore.getState().status).toBe('anonymous'));
  });

  it('enrols TOTP: setup shows the manual key, a wrong code is rejected inline, a right code enables and refreshes the profile', async () => {
    const user = userEvent.setup();
    let enableBody: unknown;
    let me = { ...adminFinance, mfaSetupRequired: true };
    server.use(
      http.post(`${BASE}/admin/me/mfa/setup`, () =>
        HttpResponse.json({ secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/Gize%20Admin:finance%40rap.et?secret=JBSWY3DPEHPK3PXP&issuer=Gize%20Admin', issuer: 'Gize Admin', account: 'finance@rap.et' }),
      ),
      http.post(`${BASE}/admin/me/mfa/enable`, async ({ request }) => {
        enableBody = await request.json();
        if ((enableBody as { code: string }).code !== '135790') return HttpResponse.json({ statusCode: 400, code: 'MFA_CODE_INVALID', message: 'bad' }, { status: 400 });
        me = { ...me, mfaEnabled: true, mfaSetupRequired: false };
        return HttpResponse.json({ mfaEnabled: true, mfaEnabledAt: new Date().toISOString() });
      }),
      http.get(`${BASE}/admin/me`, () => HttpResponse.json(me)),
    );
    renderWithProviders(<SecurityPage />, { admin: me, route: '/account/security' });
    expect(await screen.findByTestId('pending-security-banner')).toHaveTextContent(/mandatory for the Finance role/i);
    await user.click(screen.getByTestId('mfa-start'));
    expect(await screen.findByTestId('mfa-secret')).toHaveTextContent('JBSW Y3DP EHPK 3PXP');
    expect(screen.getByRole('link', { name: /open in authenticator app/i })).toHaveAttribute('href', expect.stringContaining('otpauth://totp/'));

    await user.type(screen.getByTestId('mfa-code'), '000000');
    await user.click(screen.getByTestId('mfa-enable'));
    expect(await screen.findByTestId('mfa-code-error')).toHaveTextContent(/not valid/i);

    await user.clear(screen.getByTestId('mfa-code'));
    await user.type(screen.getByTestId('mfa-code'), '135790');
    await user.click(screen.getByTestId('mfa-enable'));
    await waitFor(() => expect(enableBody).toEqual({ code: '135790' }));
    expect(await screen.findByText('Two-factor authentication enabled')).toBeInTheDocument();
    await waitFor(() => expect(authStore.getState().admin?.mfaEnabled).toBe(true));
    expect(screen.queryByTestId('pending-security-banner')).not.toBeInTheDocument();
  });
});
