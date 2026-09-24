import { API_ROUTES } from '@rap/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { paymentFixture } from '@/test/mocks/fixtures';
import { url } from '@/test/mocks/handlers';
import { server } from '@/test/mocks/server';
import { renderWithApp } from '@/test/render';
import { topupContextStore } from './topup-context';
import { TopupDialog } from './topup-dialog';
import { TopupReturnPanel } from './topup-return';

describe('TopupDialog', () => {
  it('enforces the minimum amount client-side', async () => {
    const user = userEvent.setup();
    renderWithApp(<TopupDialog open onOpenChange={() => {}} />, { authenticated: true });
    const amount = screen.getByRole('spinbutton', { name: /^Amount/ });
    await user.clear(amount);
    await user.type(amount, '50');
    await user.click(screen.getByRole('button', { name: /Continue to payment/ }));
    expect(await screen.findByText('The minimum top-up is ETB 100')).toBeInTheDocument();
  });

  it('creates the top-up, remembers the return context and redirects to a real gateway', async () => {
    server.use(
      http.post(url(API_ROUTES.billing.topups), async ({ request }) => {
        const body = (await request.json()) as { amountEtb: number; returnUrl?: string };
        expect(body.returnUrl).toMatch(/\/billing\/return$/);
        return HttpResponse.json(
          { paymentId: 'pay-real', txRef: 'RAP-REAL-1', amountEtb: body.amountEtb, status: 'pending', checkoutUrl: 'https://checkout.chapa.co/x', mock: false },
          { status: 201 },
        );
      }),
    );
    const redirect = vi.fn();
    const user = userEvent.setup();
    renderWithApp(<TopupDialog open onOpenChange={() => {}} suggestedAmountEtb={2500} returnTo="/campaigns/camp-1" returnLabel="Back to campaign" redirect={redirect} />, {
      authenticated: true,
    });
    expect(screen.getByRole('spinbutton', { name: /^Amount/ })).toHaveValue(2500);
    await user.click(screen.getByRole('button', { name: /Continue to payment · ETB 2,500\.00/ }));

    await waitFor(() => expect(redirect).toHaveBeenCalledWith('https://checkout.chapa.co/x'));
    expect(topupContextStore.get('RAP-REAL-1')).toMatchObject({ paymentId: 'pay-real', amountEtb: 2500, returnTo: '/campaigns/camp-1' });
  });

  it('settles mock-gateway payments in-app and lands on the return route', async () => {
    let paid: string | null = null;
    server.use(
      http.post(url(API_ROUTES.billing.mockCheckoutPay(':txRef')), async ({ params, request }) => {
        paid = `${params.txRef}:${((await request.json()) as { outcome: string }).outcome}`;
        return HttpResponse.json({ status: 'completed' }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    const { router } = renderWithApp(<TopupDialog open onOpenChange={() => {}} />, { authenticated: true, route: '/billing' });
    await user.click(screen.getByRole('button', { name: /Continue to payment/ }));
    expect(await screen.findByText('Test payment')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Pay ETB 1,000\.00 \(test\)/ }));

    await waitFor(() => expect(paid).toBe('RAP-NEW-1:success'));
    await waitFor(() => expect(router.state.location.search).toBe('?topup=RAP-NEW-1'));
    expect(router.state.location.pathname).toBe('/billing');
  });
});

describe('TopupReturnPanel', () => {
  it('polls the payment until it settles, then shows a receipt with the return action', async () => {
    let calls = 0;
    server.use(
      http.get(url(API_ROUTES.billing.payment(':id')), () => {
        calls += 1;
        return HttpResponse.json(calls < 2 ? paymentFixture : { ...paymentFixture, status: 'completed', paidAt: '2026-09-24T09:10:00.000Z' });
      }),
    );
    topupContextStore.save({ paymentId: paymentFixture.id, txRef: paymentFixture.txRef, amountEtb: 1000, returnTo: '/campaigns/camp-1', returnLabel: 'Back to campaign' });
    renderWithApp(<TopupReturnPanel params={{ txRef: paymentFixture.txRef, paymentId: null }} onDone={() => {}} />, { authenticated: true });

    expect(await screen.findByText(/Confirming your payment/)).toBeInTheDocument();
    expect(await screen.findByText('Payment received', {}, { timeout: 6000 })).toBeInTheDocument();
    expect(screen.getByText('ETB 1,000.00')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to campaign/ })).toHaveAttribute('href', '/campaigns/camp-1');
    expect(await screen.findByRole('link', { name: /View invoice INV-2026-0001/ })).toBeInTheDocument();
    await waitFor(() => expect(topupContextStore.get(paymentFixture.txRef)).toBeNull());
  });

  it('explains a failed payment and offers to try again', async () => {
    server.use(http.get(url(API_ROUTES.billing.payment(':id')), () => HttpResponse.json({ ...paymentFixture, status: 'failed' })));
    renderWithApp(<TopupReturnPanel params={{ txRef: paymentFixture.txRef, paymentId: paymentFixture.id }} onDone={() => {}} />, { authenticated: true });
    expect(await screen.findByText('Payment failed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute('href', '/billing?topup=start');
  });
});
