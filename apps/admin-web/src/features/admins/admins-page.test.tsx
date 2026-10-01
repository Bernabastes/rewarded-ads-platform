import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { adminSuper, BASE } from '@/test/msw/fixtures';
import { server } from '@/test/msw/server';
import { renderWithProviders } from '@/test/utils';
import { AdminsPage } from './admins-page';

const accounts = [
  { id: 'admin-super', email: 'super@rap.et', fullName: 'Selam Abraham', role: 'super_admin', active: true, mfaEnabled: true, mustChangePassword: false, lastLoginAt: '2026-10-01T08:00:00.000Z', passwordChangedAt: null, createdBy: null, createdAt: '2026-09-01T00:00:00.000Z' },
  { id: 'admin-reviewer', email: 'reviewer@rap.et', fullName: 'Dawit Kebede', role: 'ad_reviewer', active: true, mfaEnabled: false, mustChangePassword: true, lastLoginAt: null, passwordChangedAt: null, createdBy: 'admin-super', createdAt: '2026-09-20T00:00:00.000Z' },
];

describe('AdminsPage (Phase 5 #5, super_admin)', () => {
  it('lists accounts with their security state and creates an admin showing the one-time temporary password', async () => {
    const user = userEvent.setup();
    let body: unknown;
    server.use(
      http.get(`${BASE}/admin/admins`, () => HttpResponse.json({ data: accounts, meta: { total: accounts.length } })),
      http.post(`${BASE}/admin/admins`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          { admin: { ...accounts[1], id: 'admin-new', email: 'hana@rap.et', fullName: 'Hana Tesfaye', role: 'finance' }, temporaryPassword: 'Qx7mPz2kLw9tRv4a' },
          { status: 201 },
        );
      }),
    );
    renderWithProviders(<AdminsPage />, { admin: adminSuper, route: '/admins' });
    expect(await screen.findByText('reviewer@rap.et')).toBeInTheDocument();
    expect(screen.getByText('temp password')).toBeInTheDocument();
    expect(screen.getByText('MFA')).toBeInTheDocument();
    // you cannot deactivate yourself
    expect(screen.getByTestId('active-super@rap.et')).toBeDisabled();

    await user.click(screen.getByTestId('create-admin'));
    await user.type(await screen.findByLabelText(/full name/i), 'Hana Tesfaye');
    await user.type(screen.getByLabelText(/^email/i), 'hana@rap.et');
    await user.selectOptions(screen.getByLabelText(/role/i), 'finance');
    await user.click(screen.getByTestId('create-admin-submit'));
    await waitFor(() => expect(body).toEqual({ email: 'hana@rap.et', fullName: 'Hana Tesfaye', role: 'finance' }));
    expect(await screen.findByTestId('temporary-password')).toHaveTextContent('Qx7mPz2kLw9tRv4a');
    expect(screen.getByText(/shown only once/i)).toBeInTheDocument();
  });

  it('changes a role with a reason and surfaces LAST_SUPER_ADMIN inline', async () => {
    const user = userEvent.setup();
    let body: unknown;
    server.use(
      http.get(`${BASE}/admin/admins`, () => HttpResponse.json({ data: accounts, meta: { total: accounts.length } })),
      http.patch(`${BASE}/admin/admins/:id/role`, async ({ request, params }) => {
        body = await request.json();
        if (params.id === 'admin-super') return HttpResponse.json({ statusCode: 409, code: 'LAST_SUPER_ADMIN', message: 'x' }, { status: 409 });
        return HttpResponse.json({ ...accounts[1], role: (body as { role: string }).role });
      }),
    );
    renderWithProviders(<AdminsPage />, { admin: adminSuper, route: '/admins' });
    await user.click(await screen.findByTestId('role-super@rap.et'));
    await user.selectOptions(await screen.findByLabelText(/new role/i), 'support');
    await user.click(screen.getByTestId('change-role-submit'));
    expect(await screen.findByText(/at least 5 characters/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/reason/i), 'stepping down');
    await user.click(screen.getByTestId('change-role-submit'));
    expect(await screen.findByText(/without an active super admin/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    await user.click(screen.getByTestId('role-reviewer@rap.et'));
    await user.selectOptions(await screen.findByLabelText(/new role/i), 'support');
    await user.type(screen.getByLabelText(/reason/i), 'moving to support');
    await user.click(screen.getByTestId('change-role-submit'));
    await waitFor(() => expect(body).toEqual({ role: 'support', reason: 'moving to support' }));
    expect(await screen.findByText('Role changed')).toBeInTheDocument();
  });
});
