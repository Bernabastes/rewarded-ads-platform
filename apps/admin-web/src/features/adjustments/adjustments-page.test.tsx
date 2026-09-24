import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { adminFinance, adminSuper, BASE, pendingAdjustment } from '@/test/msw/fixtures';
import { server } from '@/test/msw/server';
import { renderWithProviders } from '@/test/utils';
import { AdjustmentSheet } from './adjustments-page';
import { CreateAdjustmentDialog } from './create-adjustment-dialog';

const userRow = {
  id: 'user-2',
  phoneNumber: '+251911000274',
  fullName: 'Rahel Girma',
  dateOfBirth: '1990-01-01',
  ageVerificationStatus: 'verified_adult',
  languagePreference: 'am',
  status: 'active',
  trustScore: 70,
  coinBalance: 1200,
  notificationPrefs: { rewards: true, withdrawals: true, offers: true },
  profileComplete: true,
  createdAt: '2026-09-01T00:00:00.000Z',
  deviceId: null,
  statusReason: null,
  openFlags: 0,
  lastLoginAt: null,
};

describe('AdjustmentSheet self-approval guard', () => {
  it('blocks the requester from approving their own request but offers cancel', async () => {
    renderWithProviders(<AdjustmentSheet id={pendingAdjustment.id} initial={pendingAdjustment} coinsPerEtb={100} onClose={vi.fn()} />, { admin: adminFinance, route: '/adjustments/adj-1' });
    const approve = await screen.findByTestId('approve-adjustment');
    expect(approve).toBeDisabled();
    expect(screen.getByTestId('self-approval-hint')).toHaveTextContent(/different finance or super admin/);
    expect(screen.getByRole('button', { name: /cancel my request/i })).toBeInTheDocument();
    expect(screen.getByText('(ETB 5.00)')).toBeInTheDocument();
  });

  it('lets a different admin approve; the executed state links to the ledger entry and audit rows', async () => {
    const user = userEvent.setup();
    let current = pendingAdjustment;
    server.use(
      http.get(`${BASE}/admin/coin-adjustments/:id`, () => HttpResponse.json(current)),
      http.post(`${BASE}/admin/coin-adjustments/:id/approve`, () => {
        current = { ...pendingAdjustment, status: 'executed', approvedBy: adminSuper.id, approvedByEmail: adminSuper.email, ledgerEntryId: 'ledger-123', executedAt: '2026-09-24T12:00:00.000Z' };
        return HttpResponse.json(current, { status: 201 });
      }),
    );
    renderWithProviders(<AdjustmentSheet id={pendingAdjustment.id} initial={pendingAdjustment} coinsPerEtb={100} onClose={vi.fn()} />, { admin: adminSuper, route: '/adjustments/adj-1' });
    const approve = await screen.findByTestId('approve-adjustment');
    expect(approve).toBeEnabled();
    expect(screen.queryByRole('button', { name: /cancel my request/i })).not.toBeInTheDocument();
    await user.click(approve);
    await user.click(await screen.findByRole('button', { name: /approve & write ledger/i }));
    expect(await screen.findByText('Adjustment executed')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('link', { name: /ledger entry/i })).toHaveAttribute('href', '/users/user-2?tab=ledger&highlight=ledger-123'));
    expect(screen.getByRole('link', { name: /audit rows/i })).toHaveAttribute('href', '/audit?targetId=adj-1');
    expect(screen.queryByTestId('approve-adjustment')).not.toBeInTheDocument();
  });
});

describe('CreateAdjustmentDialog', () => {
  it('validates required fields and maps server INSUFFICIENT_BALANCE onto the amount field', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${BASE}/admin/users`, () => HttpResponse.json({ data: [userRow], meta: { page: 1, limit: 8, total: 1 } })),
      http.post(`${BASE}/admin/coin-adjustments`, () => HttpResponse.json({ statusCode: 422, code: 'INSUFFICIENT_BALANCE', message: 'x', details: { coinBalance: 1200 } }, { status: 422 })),
    );
    renderWithProviders(<CreateAdjustmentDialog open onOpenChange={vi.fn()} />, { admin: adminFinance, route: '/adjustments' });
    await user.click(screen.getByRole('button', { name: /submit for approval/i }));
    expect(await screen.findByText('Pick the user to adjust.')).toBeInTheDocument();
    expect(screen.getByText('Give a reason of at least 5 characters.')).toBeInTheDocument();

    await user.type(screen.getByRole('combobox'), '+2519110002');
    await user.click(await screen.findByRole('option', { name: /Rahel Girma/ }));
    expect(screen.getByText(/balance 1,200 coins/)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /deduct/i }));
    await user.type(screen.getByPlaceholderText('500'), '5000');
    expect(screen.getByText('= ETB 50.00', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('-3,800')).toBeInTheDocument(); // balance after preview goes negative
    await user.type(screen.getByPlaceholderText(/Goodwill credit/), 'Chargeback for duplicated reward');
    await user.click(screen.getByRole('button', { name: /submit for approval/i }));
    expect(await screen.findByText(/Deduction exceeds the user’s balance \(1,200 coins\)/)).toBeInTheDocument();
  });

  it('submits a signed integer amount and reports the pending request', async () => {
    const user = userEvent.setup();
    let body: unknown;
    const onCreated = vi.fn();
    server.use(
      http.get(`${BASE}/admin/users`, () => HttpResponse.json({ data: [userRow], meta: { page: 1, limit: 8, total: 1 } })),
      http.post(`${BASE}/admin/coin-adjustments`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...pendingAdjustment, id: 'adj-new' }, { status: 201 });
      }),
    );
    renderWithProviders(<CreateAdjustmentDialog open onOpenChange={vi.fn()} onCreated={onCreated} />, { admin: adminFinance, route: '/adjustments' });
    await user.type(screen.getByRole('combobox'), '+2519110002');
    await user.click(await screen.findByRole('option', { name: /Rahel Girma/ }));
    await user.type(screen.getByPlaceholderText('500'), '250');
    await user.type(screen.getByPlaceholderText(/Goodwill credit/), 'Goodwill credit for failed playback');
    await user.type(screen.getByPlaceholderText('TICKET-452'), 'T-1');
    await user.click(screen.getByRole('button', { name: /submit for approval/i }));
    await waitFor(() => expect(body).toEqual({ userId: 'user-2', amount: 250, reason: 'Goodwill credit for failed playback', reference: 'T-1' }));
    expect(await screen.findByText('Adjustment requested')).toBeInTheDocument();
    expect(onCreated).toHaveBeenCalledWith('adj-new');
  });
});
