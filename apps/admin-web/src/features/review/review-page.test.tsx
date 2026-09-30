import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { adminReviewer, BASE, correctedAd, failedMediaAd, pendingAd, processingAd, reviewQueue } from '@/test/msw/fixtures';
import { server } from '@/test/msw/server';
import { renderWithProviders } from '@/test/utils';
import { ReviewPage } from './review-page';

const allAds = [pendingAd, { ...pendingAd, id: 'ad-2', title: 'Eid promo - 15s' }, processingAd, failedMediaAd, correctedAd];

/** Filter-aware queue handler mirroring the API (`?status=` default pending, optional `?mediaStatus=`). Records every request URL. */
function useFilteringQueue(requests: URL[]) {
  server.use(
    http.get(`${BASE}/admin/ads/review-queue`, ({ request }) => {
      const url = new URL(request.url);
      requests.push(url);
      const status = url.searchParams.get('status') ?? 'pending';
      const mediaStatus = url.searchParams.get('mediaStatus');
      if (mediaStatus === '') return HttpResponse.json({ statusCode: 400, code: 'VALIDATION_ERROR', message: 'mediaStatus must be a valid enum value' }, { status: 400 });
      const rows = allAds.filter((a) => a.reviewStatus === status && (!mediaStatus || a.mediaStatus === mediaStatus));
      const limit = Number(url.searchParams.get('limit') ?? 50);
      return HttpResponse.json({ data: rows.slice(0, limit), meta: { page: 1, limit, total: rows.length } });
    }),
  );
}

describe('ReviewPage media status filter (P4-F3)', () => {
  it('sends ?mediaStatus= to the review-queue endpoint, mirrors it in the URL and lists only matching creatives', async () => {
    const user = userEvent.setup();
    const requests: URL[] = [];
    useFilteringQueue(requests);
    const { router } = renderWithProviders(<ReviewPage />, { admin: adminReviewer, route: '/review', path: '/review/:adId?' });

    const list = await screen.findByRole('listbox', { name: /pending ads/i });
    expect(within(list).getAllByRole('option')).toHaveLength(allAds.length);
    expect(requests.at(-1)?.searchParams.has('mediaStatus')).toBe(false);

    const filter = screen.getByTestId('media-filter');
    expect(within(filter).getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(filter).getByRole('button', { name: /^Failed/ }));

    await waitFor(() => expect(router.state.location.search).toContain('mediaStatus=failed'));
    await waitFor(() => expect(requests.some((u) => u.searchParams.get('mediaStatus') === 'failed' && u.searchParams.get('status') === 'pending')).toBe(true));
    const filtered = await screen.findByRole('listbox', { name: /pending ads/i });
    await waitFor(() => expect(within(filtered).getAllByRole('option')).toHaveLength(1));
    expect(within(filtered).getByText(failedMediaAd.title)).toBeInTheDocument();
    expect(within(filter).getByRole('button', { name: /^Failed/ })).toHaveAttribute('aria-pressed', 'true');
    // The pending tab keeps the unfiltered total (fetched with limit=1, no mediaStatus).
    expect(requests.some((u) => u.searchParams.get('limit') === '1' && !u.searchParams.has('mediaStatus'))).toBe(true);
    await waitFor(() => expect(screen.getByRole('tab', { name: /pending/i })).toHaveTextContent(String(allAds.length)));
    // Never sends an empty mediaStatus (the API would answer 400).
    expect(requests.every((u) => u.searchParams.get('mediaStatus') !== '')).toBe(true);

    // "All" clears the filter and removes the param from the URL.
    await user.click(within(filter).getByRole('button', { name: /^All/ }));
    await waitFor(() => expect(router.state.location.search).not.toContain('mediaStatus'));
    await waitFor(() => expect(within(screen.getByRole('listbox', { name: /pending ads/i })).getAllByRole('option')).toHaveLength(allAds.length));
  }, 20_000);

  it('restores the filter from a shared URL and shows a count-aware empty state with a one-click reset', async () => {
    const user = userEvent.setup();
    const requests: URL[] = [];
    useFilteringQueue(requests);
    const { router } = renderWithProviders(<ReviewPage />, { admin: adminReviewer, route: '/review?status=approved&mediaStatus=processing', path: '/review/:adId?' });

    expect(await screen.findByText('No processing creatives')).toBeInTheDocument();
    expect(await screen.findByText('There are no approved ads at all right now.')).toBeInTheDocument();
    expect(screen.getByTestId('media-filter').querySelector('[aria-pressed="true"]')).toHaveTextContent('Processing');
    expect(requests.some((u) => u.searchParams.get('status') === 'approved' && u.searchParams.get('mediaStatus') === 'processing')).toBe(true);

    await user.click(screen.getByTestId('media-filter-clear'));
    await waitFor(() => expect(router.state.location.search).toBe('?status=approved'));
    expect(await screen.findByText('No approved ads')).toBeInTheDocument();
  });

  it('explains how many ads exist in the tab when the filter matches nothing', async () => {
    server.use(
      http.get(`${BASE}/admin/ads/review-queue`, ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('mediaStatus') === 'duration_corrected') return HttpResponse.json({ data: [], meta: { page: 1, limit: 50, total: 0 } });
        return HttpResponse.json({ ...reviewQueue, meta: { ...reviewQueue.meta, limit: Number(url.searchParams.get('limit') ?? 50), total: 2 } });
      }),
    );
    renderWithProviders(<ReviewPage />, { admin: adminReviewer, route: '/review?mediaStatus=duration_corrected', path: '/review/:adId?' });
    expect(await screen.findByText('No duration corrected creatives')).toBeInTheDocument();
    expect(await screen.findByText('None of the 2 pending ads are duration-corrected.')).toBeInTheDocument();
  });
});
