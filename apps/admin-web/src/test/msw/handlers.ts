import { http, HttpResponse } from 'msw';
import { adminSuper, BASE, config, largeWithdrawal, overview, pendingAdjustment, reviewQueue, tokens } from './fixtures';

/** Default happy-path handlers; individual tests override with `server.use(...)`. */
export const handlers = [
  http.post(`${BASE}/auth/admin/login`, async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string };
    if (body.password !== 'Admin123!') {
      return HttpResponse.json({ statusCode: 401, code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' }, { status: 401 });
    }
    return HttpResponse.json({ tokens: tokens(), admin: adminSuper }, { status: 201 });
  }),
  http.post(`${BASE}/auth/refresh`, () => HttpResponse.json(tokens('2'), { status: 201 })),
  http.post(`${BASE}/auth/logout`, () => new HttpResponse(null, { status: 204 })),
  http.get(`${BASE}/admin/me`, () => HttpResponse.json(adminSuper)),
  http.get(`${BASE}/admin/overview`, () => HttpResponse.json(overview)),
  http.get(`${BASE}/admin/config`, () => HttpResponse.json(config)),
  http.get(`${BASE}/admin/fraud/metrics`, () =>
    HttpResponse.json({
      weekly: { rawCompletions: 32, flaggedCompletions: 4, rejectedCompletions: 7, flaggedRate: 0.3438 },
      openFlagsBySeverity: { low: 5, medium: 3, high: 7, critical: 0 },
      flagsByType: [{ flagType: 'EARLY_COMPLETION', count: 4 }],
      suspendedUsers: 2,
      bannedUsers: 1,
      lowTrustUsers: 1,
      ledgerDriftsDetected: 0,
      daily: [{ date: '2026-09-24', rawCompletions: 12, flaggedCompletions: 1, rejectedCompletions: 3 }],
    }),
  ),
  http.get(`${BASE}/admin/ads/review-queue`, () => HttpResponse.json(reviewQueue)),
  http.get(`${BASE}/admin/withdrawals`, () => HttpResponse.json({ data: [largeWithdrawal], meta: { page: 1, limit: 20, total: 1 } })),
  http.get(`${BASE}/admin/withdrawals/:id`, () => HttpResponse.json(largeWithdrawal)),
  http.get(`${BASE}/admin/coin-adjustments`, () => HttpResponse.json({ data: [pendingAdjustment], meta: { page: 1, limit: 20, total: 1 } })),
  http.get(`${BASE}/admin/users`, () => HttpResponse.json({ data: [], meta: { page: 1, limit: 20, total: 0 } })),
];
