import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { adminFinance, adminSuper, alertCritical, alertsOpen, BASE } from '@/test/msw/fixtures';
import { server } from '@/test/msw/server';
import { renderWithProviders } from '@/test/utils';
import { AlertsPage } from './alerts-page';

describe('Alerts page', () => {
  it('lists open alerts with severity colouring, notifier pills and the open count; finance cannot run rules', async () => {
    renderWithProviders(<AlertsPage />, { admin: adminFinance, route: '/alerts' });
    const table = await screen.findByRole('table', { name: /platform alerts/i });
    expect(await within(table).findByText(alertCritical.title)).toBeInTheDocument();
    expect(within(table).getAllByText('critical')[0]).toBeInTheDocument();
    expect(within(table).getAllByText('warning')[0]).toBeInTheDocument();
    expect(screen.getByTestId('notifier-pills')).toHaveTextContent('log · mock');
    expect(screen.queryByTestId('run-rules')).not.toBeInTheDocument();
    // acknowledge buttons exist for finance (rows are role=button too, so anchor on the aria-label prefix)
    expect(within(table).getAllByRole('button', { name: /^Acknowledge / })).toHaveLength(2);
  });

  it('acknowledges an alert and treats ALERT_ALREADY_ACKNOWLEDGED as "refresh"', async () => {
    const user = userEvent.setup();
    let ackCalls = 0;
    server.use(
      http.post(`${BASE}/admin/alerts/:id/ack`, ({ params }) => {
        ackCalls += 1;
        if (params.id === 'alert-2') return HttpResponse.json({ statusCode: 409, code: 'ALERT_ALREADY_ACKNOWLEDGED', message: 'x' }, { status: 409 });
        return HttpResponse.json({ ...alertCritical, acknowledgedAt: '2026-09-30T08:00:00.000Z', acknowledgedBy: adminSuper.id });
      }),
    );
    renderWithProviders(<AlertsPage />, { admin: adminSuper, route: '/alerts' });
    const table = await screen.findByRole('table', { name: /platform alerts/i });
    await user.click(await within(table).findByRole('button', { name: `Acknowledge ${alertCritical.title}` }));
    expect(await screen.findByText('Alert acknowledged')).toBeInTheDocument();
    await user.click(within(table).getByRole('button', { name: /^Acknowledge 25 otp requests/i }));
    expect(await screen.findByText('Already acknowledged')).toBeInTheDocument();
    expect(ackCalls).toBe(2);
  });

  it('super admin can run the rules now and sees the per-rule summary', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${BASE}/admin/alerts/run-rules`, () =>
        HttpResponse.json({
          ranAt: '2026-09-30T08:05:00.000Z',
          rules: [
            { rule: 'PAYOUT_FAILURE_RATE', raised: 0, checked: 12 },
            { rule: 'ACCOUNT_MINTING', raised: 1, checked: 40 },
            { rule: 'LEDGER_DRIFT', raised: 0, checked: 40 },
          ],
        }),
      ),
    );
    renderWithProviders(<AlertsPage />, { admin: adminSuper, route: '/alerts' });
    const table = await screen.findByRole('table', { name: /platform alerts/i });
    await within(table).findByText(alertCritical.title);
    await user.click(screen.getByTestId('run-rules'));
    const result = await screen.findByTestId('run-rules-result');
    expect(result).toHaveTextContent('ACCOUNT_MINTING');
    expect(result).toHaveTextContent('1 raised');
    expect(result).toHaveTextContent('12 checked');
    expect(within(result).getAllByText('clear')).toHaveLength(2);
    expect(await screen.findByText('1 new alert raised')).toBeInTheDocument();
  });

  it('shows the empty state when everything is acknowledged', async () => {
    server.use(http.get(`${BASE}/admin/alerts`, () => HttpResponse.json({ data: [], meta: { ...alertsOpen.meta, total: 0, openCount: 0 } })));
    renderWithProviders(<AlertsPage />, { admin: adminSuper, route: '/alerts' });
    expect(await screen.findByText('No open alerts')).toBeInTheDocument();
    expect(screen.getByText('Open alerts')).toBeInTheDocument();
  });
});
