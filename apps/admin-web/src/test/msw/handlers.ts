import { http, HttpResponse } from 'msw';
import {
  adminSuper,
  alertsOpen,
  auditAdminRow,
  auditUserRow,
  BASE,
  config,
  deletionPending,
  kycDetail,
  kycMismatchDetail,
  kycQueue,
  largeWithdrawal,
  overview,
  pendingAdjustment,
  referralMetrics,
  referralRejected,
  reviewQueue,
  tokens,
} from './fixtures';

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
  http.get(`${BASE}/admin/coin-adjustments/:id`, () => HttpResponse.json(pendingAdjustment)),
  http.get(`${BASE}/admin/users`, () => HttpResponse.json({ data: [], meta: { page: 1, limit: 20, total: 0 } })),

  // Phase 4A
  http.get(`${BASE}/admin/kyc`, ({ request }) => {
    const status = new URL(request.url).searchParams.get('status') ?? 'pending';
    return HttpResponse.json(status === 'pending' ? kycQueue : { data: [], meta: { page: 1, limit: 50, total: 0 } });
  }),
  http.get(`${BASE}/admin/kyc/:id`, ({ params }) => HttpResponse.json(params.id === kycMismatchDetail.id ? kycMismatchDetail : kycDetail)),
  http.get(`${BASE}/admin/alerts`, ({ request }) => {
    const state = new URL(request.url).searchParams.get('acknowledged');
    return HttpResponse.json(state === 'true' ? { data: [], meta: { ...alertsOpen.meta, total: 0 } } : alertsOpen);
  }),
  http.get(`${BASE}/admin/referrals/metrics`, () => HttpResponse.json(referralMetrics)),
  http.get(`${BASE}/admin/referrals`, () => HttpResponse.json({ data: [referralRejected], meta: { page: 1, limit: 50, total: 1 } })),
  http.get(`${BASE}/admin/deletion-requests`, () => HttpResponse.json({ data: [deletionPending], meta: { page: 1, limit: 50, total: 1 } })),
  http.get(`${BASE}/admin/audit-log`, () => HttpResponse.json({ data: [auditAdminRow, auditUserRow], meta: { page: 1, limit: 100, total: 2 } })),
];
