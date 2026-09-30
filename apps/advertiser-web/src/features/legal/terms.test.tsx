import { API_ROUTES, type CampaignSummary } from '@rap/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { Button } from '@/components/ui/button';
import { RegisterPage } from '@/features/auth/register-page';
import { useSubmitCampaignFlow } from '@/features/campaigns/submit-flow';
import { authStore } from '@/lib/api/auth-store';
import {
  acceptedConsentStateFixture,
  draftCampaignFixture,
  outdatedTermsProfileFixture,
  tokensFixture,
} from '@/test/mocks/fixtures';
import { url } from '@/test/mocks/handlers';
import { server } from '@/test/mocks/server';
import { renderWithApp } from '@/test/render';
import { TermsGate } from './terms-gate';

function signInOutdated() {
  authStore.signIn(tokensFixture, outdatedTermsProfileFixture, true);
}

describe('TermsGate', { timeout: 20_000 }, () => {
  it('renders nothing when the current terms are accepted', async () => {
    renderWithApp(<TermsGate />, { authenticated: true });
    await waitFor(() => expect(authStore.getState().status).toBe('authenticated'));
    expect(screen.queryByTestId('terms-banner')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the accept modal with the rendered document and blocks Accept until ticked', async () => {
    signInOutdated();
    renderWithApp(<TermsGate />);

    expect(screen.getByTestId('terms-banner')).toHaveTextContent(
      'Updated advertiser terms (v1.1) need your acceptance',
    );
    const dialog = await screen.findByRole('dialog');
    // Markdown from GET /legal/current is rendered, not shown as raw text.
    expect(await within(dialog).findByRole('heading', { name: 'Gize Terms of Service (v1.1)' })).toBeVisible();
    expect(within(dialog).getByText('honestly').tagName).toBe('STRONG');
    expect(within(dialog).getByRole('link', { name: 'https://gize.app/legal/terms' })).toHaveAttribute(
      'href',
      'https://gize.app/legal/terms',
    );
    expect(within(dialog).getByRole('button', { name: /Accept and continue/ })).toBeDisabled();
  });

  it('posts the current version, patches the cached profile and closes the gate', async () => {
    let posted: { kind: string; version: string } | null = null;
    server.use(
      http.post(url(API_ROUTES.advertisers.consents), async ({ request }) => {
        posted = (await request.json()) as { kind: string; version: string };
        return HttpResponse.json(acceptedConsentStateFixture);
      }),
    );
    signInOutdated();
    const user = userEvent.setup();
    renderWithApp(<TermsGate />);

    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('heading', { name: 'Gize Terms of Service (v1.1)' });
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: /Accept and continue/ }));

    await waitFor(() => expect(posted).toEqual({ kind: 'terms', version: '1.1' }));
    await waitFor(() => expect(screen.queryByTestId('terms-banner')).not.toBeInTheDocument());
    const profile = authStore.getState().session?.profile;
    expect(profile?.requiresTermsAcceptance).toBe(false);
    expect(profile?.acceptedTermsVersion).toBe('1.1');
  });

  it('"Not now" defers the modal for this version but keeps the banner (and does not re-open on re-render)', async () => {
    signInOutdated();
    const user = userEvent.setup();
    const { unmount } = renderWithApp(<TermsGate />);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('terms-banner')).toBeInTheDocument();
    unmount();

    // A page navigation re-mounts the gate: the deferral is remembered for the session.
    renderWithApp(<TermsGate />);
    expect(screen.getByTestId('terms-banner')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const user2 = userEvent.setup();
    await user2.click(screen.getByRole('button', { name: 'Review and accept' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('reloads the document and asks again when the version changed underneath (409 CONSENT_VERSION_OUTDATED)', async () => {
    let attempts = 0;
    server.use(
      http.post(url(API_ROUTES.advertisers.consents), async () => {
        attempts += 1;
        if (attempts === 1) {
          return HttpResponse.json(
            {
              statusCode: 409,
              code: 'CONSENT_VERSION_OUTDATED',
              message: 'outdated',
              details: { currentVersion: '1.2' },
            },
            { status: 409 },
          );
        }
        return HttpResponse.json({ ...acceptedConsentStateFixture, acceptedTermsVersion: '1.2', currentTermsVersion: '1.2' });
      }),
    );
    signInOutdated();
    const user = userEvent.setup();
    renderWithApp(<TermsGate />);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('heading', { name: 'Gize Terms of Service (v1.1)' });
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: /Accept and continue/ }));
    expect(await within(dialog).findByText('The terms were updated while you were reading')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

// Typing a full registration form with user-event is slow on a cold, parallel run.
describe('RegisterPage terms', { timeout: 20_000 }, () => {
  it('shows the current terms version, opens the document and sends termsVersion on register', async () => {
    let body: Record<string, unknown> | null = null;
    server.use(
      http.post(url(API_ROUTES.auth.advertiserRegister), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            tokens: tokensFixture,
            advertiser: { ...outdatedTermsProfileFixture, requiresTermsAcceptance: false, acceptedTermsVersion: '1.1' },
          },
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    renderWithApp(<RegisterPage />, { route: '/register', routes: [{ path: '/', element: <h1>Home</h1> }] });

    const termsLink = await screen.findByRole('button', { name: 'Gize Terms of Service (v1.1)' });
    await user.click(termsLink);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('heading', { name: 'Gize Terms of Service (v1.1)' });
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'I accept these terms' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // Accepting inside the dialog ticks the form checkbox.
    expect(screen.getByRole('checkbox')).toHaveAttribute('data-state', 'checked');

    await user.type(screen.getByLabelText(/Business name/), 'Sheger Fashion');
    await user.type(screen.getByLabelText(/Business registration number/), 'MT/AA/2/0099/2016');
    await user.type(screen.getByLabelText(/Contact email/), 'hello@shegerfashion.et');
    await user.type(screen.getByLabelText(/Contact phone/), '0911000002');
    await user.type(screen.getByLabelText(/^Password/), 'Advertiser123!');
    await user.type(screen.getByLabelText(/Confirm password/), 'Advertiser123!');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toMatchObject({ termsVersion: '1.1', businessName: 'Sheger Fashion' });
  });
});

function SubmitHarness({ campaign }: { campaign: CampaignSummary }) {
  const flow = useSubmitCampaignFlow();
  return (
    <>
      <Button onClick={() => void flow.submit(campaign)}>Submit for review</Button>
      {flow.dialog}
    </>
  );
}

describe('submit flow consent gating', { timeout: 20_000 }, () => {
  it('opens the terms modal on 403 CONSENT_REQUIRED and retries the submit after acceptance', async () => {
    let submits = 0;
    let consented = false;
    server.use(
      http.post(url(API_ROUTES.campaigns.submit(':id')), () => {
        submits += 1;
        if (!consented) {
          return HttpResponse.json(
            {
              statusCode: 403,
              code: 'CONSENT_REQUIRED',
              message: 'Accept the current advertiser terms before submitting campaigns',
              details: { requiresConsent: ['terms'] },
            },
            { status: 403 },
          );
        }
        return HttpResponse.json({ ...draftCampaignFixture, status: 'pending_review' });
      }),
      http.post(url(API_ROUTES.advertisers.consents), () => {
        consented = true;
        return HttpResponse.json(acceptedConsentStateFixture);
      }),
    );
    const user = userEvent.setup();
    renderWithApp(<SubmitHarness campaign={draftCampaignFixture} />, { authenticated: true });

    await user.click(screen.getByRole('button', { name: 'Submit for review' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Accept the current terms to submit')).toBeInTheDocument();
    // The server's verdict wins over the cached profile.
    expect(authStore.getState().session?.profile.requiresTermsAcceptance).toBe(true);

    await within(dialog).findByRole('heading', { name: 'Gize Terms of Service (v1.1)' });
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: /Accept and continue/ }));

    await waitFor(() => expect(submits).toBe(2));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(authStore.getState().session?.profile.requiresTermsAcceptance).toBe(false);
  });
});
