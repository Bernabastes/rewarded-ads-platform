import { API_ROUTES, IDEMPOTENCY_KEY_HEADER, type CreateTopupDto, type TopupResponse } from '@rap/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, ClientErrorCode } from '@/lib/api/errors';
import { url } from '@/test/mocks/handlers';
import { server } from '@/test/mocks/server';
import { renderWithApp } from '@/test/render';
import { createTopupIdempotent, newIdempotencyKey } from './idempotent-topup';
import { TopupDialog } from './topup-dialog';

const dto: CreateTopupDto = { amountEtb: 1000, returnUrl: 'http://localhost/billing/return' };
const topup: TopupResponse = {
  paymentId: 'pay-x',
  txRef: 'RAP-X',
  amountEtb: 1000,
  status: 'pending',
  checkoutUrl: 'https://checkout.chapa.co/x',
  returnUrl: 'http://localhost/billing/return?paymentId=pay-x&txRef=RAP-X',
  mock: false,
};

function conflict(inProgress: boolean) {
  return new ApiError({
    statusCode: 409,
    code: 'IDEMPOTENCY_KEY_REUSED',
    message: 'reused',
    details: { key: 'k', inProgress },
  });
}

describe('createTopupIdempotent', () => {
  it('generates RFC-4122 style keys within the API alphabet', () => {
    const key = newIdempotencyKey();
    expect(key).toMatch(/^[A-Za-z0-9_\-:.]{1,128}$/);
    expect(newIdempotencyKey()).not.toBe(key);
  });

  it('sends the same key on every attempt of one intent', async () => {
    const keys: string[] = [];
    let attempts = 0;
    const request = vi.fn(async (_body: CreateTopupDto, key: string) => {
      keys.push(key);
      attempts += 1;
      if (attempts === 1) throw ApiError.network();
      return topup;
    });
    const key = newIdempotencyKey();
    await expect(createTopupIdempotent(dto, { idempotencyKey: key, request })).rejects.toMatchObject({
      code: ClientErrorCode.NETWORK_ERROR,
    });
    await expect(createTopupIdempotent(dto, { idempotencyKey: key, request })).resolves.toEqual(topup);
    expect(keys).toEqual([key, key]);
  });

  it('waits and re-sends while the original request is still in progress, then returns the replayed payment', async () => {
    let attempts = 0;
    const request = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) throw conflict(true);
      return topup;
    });
    const sleep = vi.fn(async () => {});
    const onPoll = vi.fn();
    const result = await createTopupIdempotent(dto, {
      idempotencyKey: 'intent-1',
      request,
      sleep,
      onPoll,
      pollIntervalMs: 1500,
    });
    expect(result).toEqual(topup);
    expect(request).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1500);
    expect(onPoll).toHaveBeenCalledTimes(2);
  });

  it('surfaces a payload mismatch (inProgress: false) immediately so the caller mints a new key', async () => {
    const request = vi.fn(async () => {
      throw conflict(false);
    });
    const sleep = vi.fn(async () => {});
    await expect(createTopupIdempotent(dto, { idempotencyKey: 'old', request, sleep })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('gives up with TOPUP_STILL_PROCESSING after maxPolls', async () => {
    const request = vi.fn(async () => {
      throw conflict(true);
    });
    await expect(
      createTopupIdempotent(dto, { idempotencyKey: 'k', request, sleep: async () => {}, maxPolls: 2 }),
    ).rejects.toMatchObject({ code: ClientErrorCode.TOPUP_STILL_PROCESSING });
    expect(request).toHaveBeenCalledTimes(3);
  });
});

describe('TopupDialog idempotency', { timeout: 20_000 }, () => {
  it('sends an Idempotency-Key header and reuses it when the same intent is retried after a failure', async () => {
    const seen: string[] = [];
    let attempts = 0;
    server.use(
      http.post(url(API_ROUTES.billing.topups), async ({ request }) => {
        seen.push(request.headers.get(IDEMPOTENCY_KEY_HEADER) ?? '');
        attempts += 1;
        if (attempts === 1) {
          return HttpResponse.json(
            { statusCode: 503, code: 'SERVICE_UNAVAILABLE', message: 'gateway down' },
            { status: 503 },
          );
        }
        return HttpResponse.json({ ...topup, amountEtb: 1000 }, { status: 201 });
      }),
    );
    const redirect = vi.fn();
    const user = userEvent.setup();
    renderWithApp(<TopupDialog open onOpenChange={() => {}} redirect={redirect} />, { authenticated: true });

    await user.click(screen.getByRole('button', { name: /Continue to payment/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A service is temporarily unavailable');
    await user.click(screen.getByRole('button', { name: /Continue to payment/ }));
    await waitFor(() => expect(redirect).toHaveBeenCalledWith(topup.checkoutUrl));

    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatch(/^[A-Za-z0-9_\-:.]{1,128}$/);
    expect(seen[1]).toBe(seen[0]);
  });

  it('uses a fresh key for a different amount', async () => {
    const seen: string[] = [];
    server.use(
      http.post(url(API_ROUTES.billing.topups), async ({ request }) => {
        seen.push(request.headers.get(IDEMPOTENCY_KEY_HEADER) ?? '');
        const body = (await request.json()) as { amountEtb: number };
        return HttpResponse.json({ ...topup, amountEtb: body.amountEtb }, { status: 201 });
      }),
    );
    const redirect = vi.fn();
    const user = userEvent.setup();
    renderWithApp(<TopupDialog open onOpenChange={() => {}} redirect={redirect} />, { authenticated: true });
    await user.click(screen.getByRole('button', { name: /Continue to payment/ }));
    await waitFor(() => expect(redirect).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: '2,500' }));
    await user.click(screen.getByRole('button', { name: /Continue to payment/ }));
    await waitFor(() => expect(redirect).toHaveBeenCalledTimes(2));
    expect(seen).toHaveLength(2);
    expect(seen[1]).not.toBe(seen[0]);
  });

  it('polls instead of re-posting when the API reports the previous request is still in progress', async () => {
    let attempts = 0;
    server.use(
      http.post(url(API_ROUTES.billing.topups), () => {
        attempts += 1;
        if (attempts === 1) {
          return HttpResponse.json(
            {
              statusCode: 409,
              code: 'IDEMPOTENCY_KEY_REUSED',
              message: 'in progress',
              details: { key: 'k', inProgress: true },
            },
            { status: 409 },
          );
        }
        return HttpResponse.json(topup, { status: 201 });
      }),
    );
    const redirect = vi.fn();
    const user = userEvent.setup();
    renderWithApp(<TopupDialog open onOpenChange={() => {}} redirect={redirect} />, { authenticated: true });
    await user.click(screen.getByRole('button', { name: /Continue to payment/ }));
    expect(await screen.findByTestId('topup-waiting')).toBeInTheDocument();
    await waitFor(() => expect(redirect).toHaveBeenCalledWith(topup.checkoutUrl), { timeout: 5000 });
    expect(attempts).toBe(2);
  });
});
