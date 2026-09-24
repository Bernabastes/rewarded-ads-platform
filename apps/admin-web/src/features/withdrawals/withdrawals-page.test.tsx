import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { adminFinance, adminSuper, BASE, largeWithdrawal } from '@/test/msw/fixtures';
import { server } from '@/test/msw/server';
import { renderWithProviders } from '@/test/utils';
import { WithdrawalSheet } from './withdrawals-page';

describe('WithdrawalSheet dual approval', () => {
  it('disables Approve for the admin who already approved and explains why', async () => {
    renderWithProviders(<WithdrawalSheet id={largeWithdrawal.id} initial={largeWithdrawal} onClose={vi.fn()} />, { admin: adminFinance, route: '/withdrawals/wd-650' });
    const approve = await screen.findByTestId('approve-withdrawal');
    expect(approve).toBeDisabled();
    expect(approve).toHaveTextContent('Approve (2 of 2)');
    expect(screen.getByTestId('dual-approval-hint')).toHaveTextContent(/different finance or super admin/);
    expect(screen.getByText('Dual approval · 1 of 2')).toBeInTheDocument();
    expect(screen.getByText('you')).toBeInTheDocument();
    // rejecting is still possible
    expect(screen.getByRole('button', { name: /reject/i })).toBeEnabled();
  });

  it('lets a different admin give the second approval, posts the note and shows the released state', async () => {
    const user = userEvent.setup();
    let body: unknown;
    let current = largeWithdrawal;
    server.use(
      http.get(`${BASE}/admin/withdrawals/:id`, () => HttpResponse.json(current)),
      http.post(`${BASE}/admin/withdrawals/:id/approve`, async ({ request }) => {
        body = await request.json();
        current = {
          ...largeWithdrawal,
          status: 'pending',
          approvalsCount: 2,
          approvals: [...largeWithdrawal.approvals, { id: 'appr-2', adminId: adminSuper.id, adminEmail: adminSuper.email, decision: 'approved', note: 'ok', createdAt: '2026-09-24T12:00:00.000Z' }],
        };
        return HttpResponse.json(current, { status: 201 });
      }),
    );
    renderWithProviders(<WithdrawalSheet id={largeWithdrawal.id} initial={largeWithdrawal} onClose={vi.fn()} />, { admin: adminSuper, route: '/withdrawals/wd-650' });
    const approve = await screen.findByTestId('approve-withdrawal');
    expect(approve).toBeEnabled();
    expect(screen.getByTestId('dual-approval-hint')).toHaveTextContent(/Yours would release the payout/);
    await user.click(approve);
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Record approval 2 of 2');
    await user.type(screen.getByRole('textbox'), 'Destination matches KYC');
    await user.click(screen.getByRole('button', { name: /approve & queue payout/i }));
    await waitFor(() => expect(body).toEqual({ note: 'Destination matches KYC' }));
    expect(await screen.findByText(/payout queued/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Dual approval · 2 of 2')).toBeInTheDocument());
    expect(screen.queryByTestId('approve-withdrawal')).not.toBeInTheDocument();
  });

  it('requires a reason to reject and refunds through the API', async () => {
    const user = userEvent.setup();
    let body: unknown;
    server.use(
      http.post(`${BASE}/admin/withdrawals/:id/reject`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...largeWithdrawal, status: 'rejected' }, { status: 201 });
      }),
    );
    renderWithProviders(<WithdrawalSheet id={largeWithdrawal.id} initial={largeWithdrawal} onClose={vi.fn()} />, { admin: adminFinance, route: '/withdrawals/wd-650' });
    await user.click(await screen.findByRole('button', { name: /^reject$/i }));
    const confirm = await screen.findByRole('button', { name: /reject & refund coins/i });
    await user.click(confirm);
    expect(await screen.findByText(/at least 5 characters/i)).toBeInTheDocument();
    expect(body).toBeUndefined();
    await user.type(screen.getByRole('textbox'), 'Destination belongs to a different person');
    await user.click(confirm);
    await waitFor(() => expect(body).toEqual({ reason: 'Destination belongs to a different person' }));
    expect(await screen.findByText('Withdrawal rejected')).toBeInTheDocument();
  });

  it('surfaces API refusals (DUAL_APPROVAL_SAME_ADMIN) as a toast', async () => {
    const user = userEvent.setup();
    const fresh = { ...largeWithdrawal, approvals: [], approvalsCount: 0 };
    server.use(
      http.get(`${BASE}/admin/withdrawals/:id`, () => HttpResponse.json(fresh)),
      http.post(`${BASE}/admin/withdrawals/:id/approve`, () => HttpResponse.json({ statusCode: 409, code: 'DUAL_APPROVAL_SAME_ADMIN', message: 'x' }, { status: 409 })),
    );
    renderWithProviders(<WithdrawalSheet id={largeWithdrawal.id} initial={fresh} onClose={vi.fn()} />, { admin: adminFinance, route: '/withdrawals/wd-650' });
    await user.click(await screen.findByTestId('approve-withdrawal'));
    await user.click(await screen.findByRole('button', { name: /record my approval/i }));
    expect(await screen.findByText('A different admin must provide the second approval.')).toBeInTheDocument();
  });
});
