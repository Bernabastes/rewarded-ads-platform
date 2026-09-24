import { API_ROUTES } from '@rap/shared';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { emptyOverviewFixture } from '@/test/mocks/fixtures';
import { url } from '@/test/mocks/handlers';
import { server } from '@/test/mocks/server';
import { renderWithApp } from '@/test/render';
import { DashboardPage } from './dashboard-page';

// Recharts + jsdom make the first render of this page slow on a cold module graph.
describe('DashboardPage', { timeout: 20_000 }, () => {
  it('renders overview cards with formatted figures and the fraud-filter hint', async () => {
    renderWithApp(<DashboardPage />, { authenticated: true });
    expect(await screen.findByText('Active campaigns')).toBeInTheDocument();
    const cards = screen.getAllByText(/Active campaigns|Total spend|Verified views|Estimated reach/);
    expect(cards).toHaveLength(4);
    // reduced motion in tests → final values render immediately
    expect(screen.getByText('4 total')).toBeInTheDocument();
    expect(screen.getByText('ETB 3,105')).toBeInTheDocument();
    expect(screen.getByText('1,248')).toBeInTheDocument();
    expect(screen.getByText(/122 filtered \(9%\)/)).toBeInTheDocument();
    expect(screen.getByText('Spend over time')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /Good (morning|afternoon|evening), Habesha Coffee Roasters PLC/ }),
    ).toBeInTheDocument();
  });

  it('shows the wallet balance and a top-up call to action', async () => {
    renderWithApp(<DashboardPage />, { authenticated: true });
    const wallet = await screen.findByText('Wallet balance');
    expect(within(wallet.closest('div')!.parentElement!).getByText('ETB 12,000.00')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Add funds/ })).toHaveAttribute('href', '/billing?topup=start');
  });

  it('renders a designed empty state for a brand-new account', async () => {
    server.use(http.get(url(API_ROUTES.campaigns.overview), () => HttpResponse.json(emptyOverviewFixture)));
    renderWithApp(<DashboardPage />, { authenticated: true });
    expect(await screen.findByText('Launch your first campaign')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Create your first campaign/ })).toHaveAttribute(
      'href',
      '/campaigns/new',
    );
    expect(screen.queryByText('Active campaigns')).not.toBeInTheDocument();
  });

  it('renders an error state with retry when the overview fails', async () => {
    server.use(
      http.get(url(API_ROUTES.campaigns.overview), () =>
        HttpResponse.json({ statusCode: 500, code: 'INTERNAL_ERROR', message: 'boom' }, { status: 500 }),
      ),
    );
    renderWithApp(<DashboardPage />, { authenticated: true });
    expect(await screen.findByText('Something went wrong on our side')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
