import { API_BASE_PATH, API_ROUTES } from '@rap/shared';
import { http, HttpResponse } from 'msw';
import {
  acceptedConsentStateFixture,
  analyticsFixture,
  campaignDetailFixture,
  campaignFixture,
  consentStateFixture,
  draftCampaignFixture,
  invoiceFixture,
  legalCurrentFixture,
  overviewFixture,
  paymentFixture,
  profileFixture,
  tokensFixture,
  walletFixture,
} from './fixtures';

export const API = `http://localhost:3000${API_BASE_PATH}`;
export const url = (path: string) => `${API}${path}`;

export const handlers = [
  http.post(url(API_ROUTES.auth.advertiserLogin), async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string };
    if (body.password !== 'Advertiser123!') {
      return HttpResponse.json(
        { statusCode: 401, code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
        { status: 401 },
      );
    }
    return HttpResponse.json({ tokens: tokensFixture, advertiser: profileFixture }, { status: 201 });
  }),
  http.post(url(API_ROUTES.auth.advertiserRegister), async ({ request }) => {
    const body = (await request.json()) as { businessName: string; contactEmail: string; termsVersion?: string };
    return HttpResponse.json(
      {
        tokens: tokensFixture,
        advertiser: {
          ...profileFixture,
          id: 'adv-new',
          businessName: body.businessName,
          contactEmail: body.contactEmail,
          verificationStatus: 'pending',
          walletBalanceEtb: 0,
          acceptedTermsVersion: body.termsVersion ?? null,
          currentTermsVersion: legalCurrentFixture.documents[0].version,
          requiresTermsAcceptance: body.termsVersion !== legalCurrentFixture.documents[0].version,
        },
      },
      { status: 201 },
    );
  }),
  http.post(url(API_ROUTES.auth.logout), () => new HttpResponse(null, { status: 204 })),
  http.post(url(API_ROUTES.auth.refresh), () =>
    HttpResponse.json({ ...tokensFixture, accessToken: 'access-token-2', refreshToken: 'refresh-token-2' }),
  ),
  http.post(url(API_ROUTES.auth.advertiserChangePassword), async ({ request }) => {
    const body = (await request.json()) as { currentPassword: string; newPassword: string };
    if (body.currentPassword !== 'Advertiser123!') {
      return HttpResponse.json(
        { statusCode: 401, code: 'INVALID_CREDENTIALS', message: 'Current password is incorrect' },
        { status: 401 },
      );
    }
    return HttpResponse.json({ changed: true, sessionsRevoked: true }, { status: 201 });
  }),
  http.get(url(API_ROUTES.legal.current), () => HttpResponse.json(legalCurrentFixture)),
  http.get(url(API_ROUTES.advertisers.me), () => HttpResponse.json(profileFixture)),
  http.patch(url(API_ROUTES.advertisers.me), async ({ request }) => {
    const body = (await request.json()) as {
      businessName?: string;
      contactPhone?: string;
      notificationPrefs?: Partial<typeof profileFixture.notificationPrefs>;
    };
    return HttpResponse.json({
      ...profileFixture,
      businessName: body.businessName ?? profileFixture.businessName,
      contactPhone: body.contactPhone ?? profileFixture.contactPhone,
      notificationPrefs: { ...profileFixture.notificationPrefs, ...body.notificationPrefs },
    });
  }),
  http.get(url(API_ROUTES.advertisers.consents), () => HttpResponse.json(consentStateFixture)),
  http.post(url(API_ROUTES.advertisers.consents), async ({ request }) => {
    const body = (await request.json()) as { kind: string; version: string };
    if (body.version !== legalCurrentFixture.documents[0].version) {
      return HttpResponse.json(
        {
          statusCode: 409,
          code: 'CONSENT_VERSION_OUTDATED',
          message: `Version ${body.version} is not the current terms version`,
          details: { currentVersion: legalCurrentFixture.documents[0].version },
        },
        { status: 409 },
      );
    }
    return HttpResponse.json(acceptedConsentStateFixture);
  }),
  http.get(url(API_ROUTES.campaigns.overview), () => HttpResponse.json(overviewFixture)),
  http.get(url(API_ROUTES.campaigns.list), () =>
    HttpResponse.json({
      data: [campaignFixture, draftCampaignFixture],
      meta: { page: 1, limit: 100, total: 2 },
    }),
  ),
  http.get(url(API_ROUTES.campaigns.detail(':id')), () => HttpResponse.json(campaignDetailFixture)),
  http.get(url(API_ROUTES.campaigns.ads(':id')), () => HttpResponse.json(campaignDetailFixture.ads)),
  http.get(url(API_ROUTES.campaigns.analytics(':id')), () => HttpResponse.json(analyticsFixture)),
  http.get(url(API_ROUTES.billing.balance), () => HttpResponse.json(walletFixture)),
  http.get(url(API_ROUTES.billing.payments), () =>
    HttpResponse.json({ data: [paymentFixture], meta: { page: 1, limit: 10, total: 1 } }),
  ),
  http.get(url(API_ROUTES.billing.payment(':id')), () => HttpResponse.json(paymentFixture)),
  http.get(url(API_ROUTES.billing.invoices), () =>
    HttpResponse.json({ data: [invoiceFixture], meta: { page: 1, limit: 10, total: 1 } }),
  ),
  http.get(url(API_ROUTES.billing.ledger), () =>
    HttpResponse.json({ data: [], meta: { page: 1, limit: 10, total: 0 } }),
  ),
  http.post(url(API_ROUTES.billing.topups), async ({ request }) => {
    const body = (await request.json()) as { amountEtb: number };
    return HttpResponse.json(
      {
        paymentId: 'pay-new',
        txRef: 'RAP-NEW-1',
        amountEtb: body.amountEtb,
        status: 'pending',
        checkoutUrl: 'http://localhost:3000/api/v1/billing/mock-checkout/RAP-NEW-1',
        mock: true,
      },
      { status: 201 },
    );
  }),
];
