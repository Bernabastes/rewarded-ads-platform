import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { adminReviewer, adminSupport, BASE, kycDetail, kycMismatch, kycMismatchDetail, kycPending } from '@/test/msw/fixtures';
import { server } from '@/test/msw/server';
import { renderWithProviders } from '@/test/utils';
import { RequireRole } from '@/components/guards/guards';
import { KycPage } from './kyc-page';

function renderQueue(route = '/kyc', admin = adminSupport) {
  return renderWithProviders(<KycPage />, { admin, route, path: '/kyc/:kycId?' });
}

describe('KYC queue', () => {
  it('lists pending submissions with pre-check scores and opens the drawer with documents, matches and warnings', async () => {
    const user = userEvent.setup();
    renderQueue();
    const table = await screen.findByRole('table', { name: /kyc submissions/i });
    expect(await within(table).findByText('Rahel Girma')).toBeInTheDocument();
    expect(within(table).getByText('97%')).toBeInTheDocument();
    expect(within(table).getByText('40%')).toBeInTheDocument();

    await user.click(within(table).getByText('Yonas Tadesse'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('KYC · Yonas T.');
    // three documents are presigned for 5 minutes → countdown + zoom buttons
    await within(dialog).findByTestId('kyc-documents');
    expect(within(dialog).getByTestId('kyc-doc-countdown')).toHaveTextContent(/0[45]:\d\d/);
    expect(within(dialog).getByRole('button', { name: /zoom document front/i })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /zoom selfie/i })).toBeInTheDocument();
    expect(within(dialog).getByText(/no back side/i)).toBeInTheDocument();
    // profile mismatch + duplicate identity + weak pre-check are surfaced as warnings (not blockers)
    expect(within(dialog).getByTestId('kyc-warnings')).toHaveTextContent(/name differs from the profile/);
    expect(within(dialog).getByTestId('kyc-warnings')).toHaveTextContent(/1 other account/);
    expect(within(dialog).getByTestId('kyc-warnings')).toHaveTextContent(/weak match/);
    expect(within(dialog).getByTestId('profile-mismatch')).toBeInTheDocument();
    expect(within(dialog).getAllByText(/MOCK/).length).toBeGreaterThan(0);
    expect(within(dialog).getByTestId('kyc-approve')).toBeEnabled();
  });

  it('approves with an optional note and removes the row from the pending queue', async () => {
    const user = userEvent.setup();
    let body: unknown;
    let pendingRows = [kycPending, kycMismatch];
    server.use(
      http.get(`${BASE}/admin/kyc`, () => HttpResponse.json({ data: pendingRows, meta: { page: 1, limit: 50, total: pendingRows.length } })),
      http.post(`${BASE}/admin/kyc/:id/approve`, async ({ request }) => {
        body = await request.json();
        pendingRows = pendingRows.filter((r) => r.id !== kycPending.id);
        return HttpResponse.json({ ...kycPending, status: 'approved', reviewedAt: '2026-09-30T08:00:00.000Z', reviewedBy: adminSupport.id }, { status: 201 });
      }),
    );
    renderQueue(`/kyc/${kycPending.id}`);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByTestId('kyc-documents');
    expect(within(dialog).queryByTestId('kyc-warnings')).not.toBeInTheDocument();
    await user.click(within(dialog).getByTestId('kyc-approve'));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('Approve Rahel Girma?');
    await user.type(within(confirm).getByRole('textbox'), 'Selfie matches the card');
    await user.click(within(confirm).getByRole('button', { name: /approve kyc/i }));
    await waitFor(() => expect(body).toEqual({ note: 'Selfie matches the card' }));
    expect(await screen.findByText('KYC approved')).toBeInTheDocument();
    // optimistic removal: Rahel is gone, the next pending row (Yonas) is selected. The drawer is still open for
    // Yonas, so the page behind it is aria-hidden (Radix) - query with hidden: true.
    const table = screen.getByRole('table', { name: /kyc submissions/i, hidden: true });
    await waitFor(() => expect(within(table).queryByText('Rahel Girma')).not.toBeInTheDocument());
    expect(within(table).getByText('Yonas Tadesse')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('KYC · Yonas T.'));
  });

  it('requires a reason to reject and sends it', async () => {
    const user = userEvent.setup();
    let body: unknown;
    server.use(
      http.get(`${BASE}/admin/kyc/:id`, () => HttpResponse.json(kycMismatchDetail)),
      http.post(`${BASE}/admin/kyc/:id/reject`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...kycMismatch, status: 'rejected', reason: 'Name on the card does not match' }, { status: 201 });
      }),
    );
    renderQueue(`/kyc/${kycMismatch.id}`);
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByTestId('kyc-reject'));
    const confirm = await screen.findByRole('alertdialog');
    const submit = within(confirm).getByRole('button', { name: /reject kyc/i });
    await user.click(submit);
    expect(await screen.findByText(/at least 3 characters/i)).toBeInTheDocument();
    expect(body).toBeUndefined();
    await user.type(within(confirm).getByRole('textbox'), 'Name on the card does not match');
    await user.click(submit);
    await waitFor(() => expect(body).toEqual({ reason: 'Name on the card does not match' }));
    expect(await screen.findByText('KYC rejected')).toBeInTheDocument();
  });

  it('handles KYC_NOT_PENDING from the API by refreshing instead of leaving the dialog open', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${BASE}/admin/kyc/:id`, () => HttpResponse.json(kycDetail)),
      http.post(`${BASE}/admin/kyc/:id/reject`, () => HttpResponse.json({ statusCode: 409, code: 'KYC_NOT_PENDING', message: 'x' }, { status: 409 })),
    );
    renderQueue(`/kyc/${kycPending.id}`);
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByTestId('kyc-reject'));
    const confirm = await screen.findByRole('alertdialog');
    await user.type(within(confirm).getByRole('textbox'), 'Blurry photo');
    await user.click(within(confirm).getByRole('button', { name: /reject kyc/i }));
    expect(await screen.findByText('Already decided')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('is hidden behind the role guard for ad reviewers', async () => {
    renderWithProviders(
      <RequireRole access="kyc">
        <KycPage />
      </RequireRole>,
      { admin: adminReviewer, route: '/kyc', path: '/kyc/:kycId?' },
    );
    expect(await screen.findByText(/don’t have access to this area/i)).toBeInTheDocument();
    expect(screen.getByText(/super admin, support, finance/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
