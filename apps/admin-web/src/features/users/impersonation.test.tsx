import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { impersonationStore } from '@/lib/auth/impersonation-store';
import { adminSupport, BASE, impersonationToken } from '@/test/msw/fixtures';
import { server } from '@/test/msw/server';
import { renderWithProviders } from '@/test/utils';
import { ImpersonationBanner } from './impersonation-banner';
import { ViewAsUserPage } from './view-as-user-page';

const profile = {
  id: 'user-1',
  phoneNumber: '+251911000137',
  fullName: 'Abebe Bikila',
  dateOfBirth: '1990-05-01',
  dateOfBirthEthiopian: { year: 1982, month: 8, day: 23 },
  ageVerificationStatus: 'verified_adult',
  languagePreference: 'am',
  status: 'active',
  trustScore: 88,
  coinBalance: 4200,
  notificationPrefs: { rewards: true, withdrawals: true, offers: false },
  profileComplete: true,
  kycTier: 'id_verified',
  referralCode: '779HLB',
  consents: [{ kind: 'terms', acceptedVersion: '1.0', currentVersion: '1.0', acceptedAt: '2026-09-01T00:00:00.000Z', outdated: false }],
  requiresConsent: [],
  createdAt: '2026-08-01T00:00:00.000Z',
};

/** Mirrors the app: the banner lives in the layout (AppShell) and survives navigation; the panel is a child route. */
function Harness() {
  return (
    <>
      <ImpersonationBanner />
      <Routes>
        <Route path="/users/:userId/view-as" element={<ViewAsUserPage />} />
        <Route path="/users/:userId" element={<div>admin user page</div>} />
      </Routes>
    </>
  );
}

const renderHarness = () => renderWithProviders(<Harness />, { admin: adminSupport, route: '/users/user-1/view-as', path: '*' });

describe('read-only impersonation ("view as user")', () => {
  afterEach(() => impersonationStore.end());

  it('sends the impersonation token (not the admin token), shows the banner with a countdown and hides write actions', async () => {
    const user = userEvent.setup();
    const seenAuth: string[] = [];
    server.use(
      http.get(`${BASE}/users/me`, ({ request }) => {
        seenAuth.push(request.headers.get('authorization') ?? '');
        return HttpResponse.json(profile);
      }),
      http.get(`${BASE}/users/me/balance`, ({ request }) => {
        seenAuth.push(request.headers.get('authorization') ?? '');
        return HttpResponse.json({ coinBalance: 4200, etbEquivalent: 42, coinsPerEtb: 100, ledgerChecksum: { entries: 12, ledgerSum: 4200, consistent: true }, conversionNote: '100 coins = ETB 1' });
      }),
      http.get(`${BASE}/users/me/ledger`, () => HttpResponse.json({ data: [{ id: 'l1', amount: 200, balanceAfter: 4200, sourceType: 'ad_view', sourceId: null, description: 'Buna Time', createdAt: '2026-09-29T10:00:00.000Z' }], meta: { page: 1, limit: 50, total: 1 } })),
      http.get(`${BASE}/ads/feed`, ({ request }) => {
        seenAuth.push(request.headers.get('authorization') ?? '');
        return HttpResponse.json({
          data: [{ id: 'ad-1', campaignId: 'c1', title: 'Morning Roast', advertiserName: 'Habesha Coffee', mediaType: 'video', mediaUrl: 'x', thumbnailUrl: null, durationSeconds: 15, rewardCoins: 100, rewardEtb: 1, estimatedSeconds: 20, hasAttentionCheck: true, targetActionType: 'video_view' }],
          meta: { page: 1, limit: 20, total: 1, dailyLimit: 15, dailyCompleted: 3, dailyRemaining: 12, hiddenByFrequencyCap: 1 },
        });
      }),
    );
    impersonationStore.start({ ...impersonationToken, expiresAt: new Date(Date.now() + 600_000).toISOString() }, 'TICKET-7');
    renderHarness();

    const banner = await screen.findByTestId('impersonation-banner');
    expect(banner).toHaveAttribute('data-state', 'active');
    expect(banner).toHaveTextContent(/Viewing as Abebe Bikila \(\+251911000137\)/);
    expect(banner).toHaveTextContent(/read-only/);
    expect(within(banner).getByTestId('impersonation-countdown')).toHaveTextContent(/^(09|10):\d\d$/);
    expect(banner).toHaveTextContent('write actions hidden');

    // profile tab loaded with the impersonation bearer, never the admin token
    expect(await screen.findByText('779HLB')).toBeInTheDocument();
    expect(seenAuth.length).toBeGreaterThan(0);
    expect(seenAuth.every((h) => h === 'Bearer impersonation-token-1')).toBe(true);

    await user.click(screen.getByRole('tab', { name: /balance & ledger/i }));
    expect(await screen.findByText('Buna Time')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /ad feed/i }));
    expect(await screen.findByText('Morning Roast')).toBeInTheDocument();
    expect(screen.getByText(/12 of 15 completions left today/)).toBeInTheDocument();
    expect(screen.getByText(/1 hidden by frequency caps/)).toBeInTheDocument();

    // no write affordances anywhere in the panel
    const panel = screen.getByTestId('view-as-panel');
    for (const label of [/approve/i, /suspend/i, /ban/i, /mark as read/i, /watch/i, /withdraw$/i, /save/i]) {
      expect(within(panel).queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
    expect(seenAuth.every((h) => h === 'Bearer impersonation-token-1')).toBe(true);
  });

  it('turns the banner into "expired" when the token runs out and closes the panel', async () => {
    server.use(http.get(`${BASE}/users/me`, () => HttpResponse.json(profile)));
    impersonationStore.start({ ...impersonationToken, expiresAt: new Date(Date.now() + 60_000).toISOString() }, 'TICKET-8');
    const { router } = renderHarness();
    await screen.findByTestId('view-as-panel');
    act(() => impersonationStore.markExpired());
    const banner = await screen.findByTestId('impersonation-banner');
    expect(banner).toHaveAttribute('data-state', 'expired');
    expect(banner).toHaveTextContent(/has expired/);
    await waitFor(() => expect(router.state.location.pathname).toBe('/users/user-1'));
    expect(screen.queryByTestId('view-as-panel')).not.toBeInTheDocument();
  });

  it('renders 403 IMPERSONATION_READ_ONLY as a friendly blocked state', async () => {
    server.use(http.get(`${BASE}/users/me`, () => HttpResponse.json({ statusCode: 403, code: 'IMPERSONATION_READ_ONLY', message: 'x' }, { status: 403 })));
    impersonationStore.start({ ...impersonationToken, expiresAt: new Date(Date.now() + 600_000).toISOString() }, 'TICKET-9');
    renderHarness();
    expect(await screen.findByText('Blocked: read-only session')).toBeInTheDocument();
    expect(screen.getByText(/Impersonation sessions are read-only/)).toBeInTheDocument();
  });

  it('explains when there is no session in memory (e.g. after a reload)', async () => {
    renderHarness();
    expect(await screen.findByText('No active impersonation session')).toBeInTheDocument();
    expect(screen.queryByTestId('impersonation-banner')).not.toBeInTheDocument();
  });
});
