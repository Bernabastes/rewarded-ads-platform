import { API_ROUTES, type AdSummary, type CampaignDetail } from '@rap/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/lib/query/keys';
import { campaignDetailFixture } from '@/test/mocks/fixtures';
import { url } from '@/test/mocks/handlers';
import { server } from '@/test/mocks/server';
import { renderWithApp } from '@/test/render';
import { ReviewStep } from './wizard/step-review';
import { AdPreview } from './creative-preview';
import {
  countMedia,
  formatBitrate,
  MediaProbeDetails,
  MediaStatusBadge,
  useMediaProcessingPoll,
} from './media-status';

const readyAd = campaignDetailFixture.ads[0];

const processingAd: AdSummary = {
  ...readyAd,
  id: 'ad-p',
  title: 'Eid promo',
  mediaUrl: 'http://localhost:9000/rap-media/creatives/eid-promo.mp4',
  thumbnailUrl: null,
  reviewStatus: 'pending',
  reviewedAt: null,
  mediaStatus: 'processing',
  mediaProbe: null,
  durationDeclaredSeconds: 15,
  durationProbedSeconds: null,
  mediaProcessedAt: null,
};

const correctedAd: AdSummary = {
  ...processingAd,
  id: 'ad-c',
  mediaStatus: 'duration_corrected',
  durationSeconds: 30,
  durationDeclaredSeconds: 15,
  durationProbedSeconds: 30,
  mediaProbe: { durationSeconds: 30, codec: 'h264', width: 720, height: 1280, bitrate: 640_000, container: 'mov,mp4,m4a' },
  thumbnailUrl: 'http://localhost:9000/rap-media/processed/ad-c/poster.png',
  mediaProcessedAt: '2026-09-24T09:00:00.000Z',
};

const failedAd: AdSummary = {
  ...processingAd,
  id: 'ad-f',
  mediaStatus: 'failed',
  mediaError: 'ffprobe: moov atom not found',
};

describe('media status presentation', () => {
  it('labels every pipeline state', () => {
    renderWithApp(
      <>
        <MediaStatusBadge status="processing" />
        <MediaStatusBadge status="ready" />
        <MediaStatusBadge status="duration_corrected" />
        <MediaStatusBadge status="failed" />
      </>,
    );
    expect(screen.getByText('Processing media')).toBeInTheDocument();
    expect(screen.getByText('Media ready')).toBeInTheDocument();
    expect(screen.getByText('Duration corrected')).toBeInTheDocument();
    expect(screen.getByText('Processing failed')).toBeInTheDocument();
  });

  it('formats bitrates and counts pipeline states', () => {
    expect(formatBitrate(640_000)).toBe('640 kbps');
    expect(formatBitrate(1_800_000)).toBe('1.8 Mbps');
    expect(countMedia([readyAd, processingAd, correctedAd, failedAd])).toEqual({ processing: 1, failed: 1, corrected: 1 });
  });

  it('shows probe facts and the declared vs measured duration note', () => {
    renderWithApp(<MediaProbeDetails ad={correctedAd} />);
    expect(screen.getByTestId('media-facts')).toHaveTextContent('720×1280 · H264 · 640 kbps · mov');
    expect(screen.getByText(/we measured/)).toHaveTextContent('You declared 0:15 (15s) → we measured 0:30 (30s)');
    expect(screen.getByText(/The measured value is used/)).toBeInTheDocument();
  });

  it('shows the failure reason with a re-upload action', async () => {
    const onReupload = vi.fn();
    const user = userEvent.setup();
    renderWithApp(<MediaProbeDetails ad={failedAd} onReupload={onReupload} />);
    expect(screen.getByText('ffprobe: moov atom not found')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Re-upload' }));
    expect(onReupload).toHaveBeenCalled();
  });

  it('shows a processing indicator and the poster/720p sources in the preview', () => {
    renderWithApp(
      <>
        <MediaProbeDetails ad={processingAd} />
        <AdPreview ad={processingAd} compact />
        <AdPreview ad={correctedAd} compact />
      </>,
    );
    expect(screen.getByRole('progressbar', { name: 'Media processing' })).toBeInTheDocument();
    expect(screen.getByText(/refreshing every 5 seconds/)).toBeInTheDocument();
    expect(screen.getByTestId('preview-processing')).toBeInTheDocument();
    const videos = screen.getAllByLabelText('Video creative: Eid promo', { selector: 'video' });
    expect(videos).toHaveLength(2);
    // Unprocessed upload: no poster yet, original file. Processed: generated poster + 720p transcode.
    expect(videos[0]).not.toHaveAttribute('poster');
    expect(videos[1]).toHaveAttribute('poster', correctedAd.thumbnailUrl!);
    expect(videos[1]).toHaveAttribute('src', correctedAd.mediaUrl);
  });

  it('warns on the review step while a creative is processing and when one failed, without blocking submit', () => {
    const campaign: CampaignDetail = { ...campaignDetailFixture, status: 'draft', ads: [processingAd, failedAd] };
    renderWithApp(
      <ReviewStep campaign={campaign} onEdit={() => {}} onBack={() => {}} onSaveDraft={() => {}} onSubmit={() => {}} submitting={false} />,
      { authenticated: true },
    );
    expect(screen.getByTestId('review-media-processing')).toHaveTextContent('1 creative is still processing');
    expect(screen.getByTestId('review-media-failed')).toHaveTextContent('1 creative failed media processing');
    expect(screen.getByRole('button', { name: /Submit for review/ })).toBeEnabled();
    expect(screen.getByText(/Max views per person per day/)).toBeInTheDocument();
  });
});

function PollHarness({
  campaign,
  intervalMs,
  maxPolls,
  onState,
}: {
  campaign: CampaignDetail;
  intervalMs: number;
  maxPolls?: number;
  onState: (state: { polling: boolean; timedOut: boolean; ads: AdSummary[] | undefined }) => void;
}) {
  // Stand-in for useCampaign(): the detail cache seeded with the given campaign; a refetch (triggered by the
  // poll's invalidation once processing finished) answers with whatever the cache holds, like a live server would.
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: queryKeys.campaigns.detail(campaign.id),
    queryFn: () => queryClient.getQueryData<CampaignDetail>(queryKeys.campaigns.detail(campaign.id)) ?? campaign,
    initialData: campaign,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const cached = detail.data;
  const poll = useMediaProcessingPoll(cached, { intervalMs, maxPolls });
  useEffect(() => {
    onState({ polling: poll.polling, timedOut: poll.timedOut, ads: cached.ads });
  });
  return (
    <ul>
      {cached.ads.map((ad) => (
        <li key={ad.id} data-testid={`ad-${ad.id}`}>
          {ad.mediaStatus}
        </li>
      ))}
    </ul>
  );
}

describe('useMediaProcessingPoll', () => {
  const campaign: CampaignDetail = { ...campaignDetailFixture, ads: [processingAd] };

  it('polls GET /campaigns/:id/ads while processing, writes into the detail cache and stops when ready', async () => {
    let calls = 0;
    server.use(
      http.get(url(API_ROUTES.campaigns.ads(':id')), () => {
        calls += 1;
        return HttpResponse.json([calls < 3 ? processingAd : { ...processingAd, mediaStatus: 'ready' }]);
      }),
    );
    const states: Array<{ polling: boolean; timedOut: boolean }> = [];
    const { client } = renderWithApp(
      <PollHarness campaign={campaign} intervalMs={40} onState={(s) => states.push(s)} />,
      { authenticated: true },
    );

    expect(screen.getByTestId('ad-ad-p')).toHaveTextContent('processing');
    await waitFor(() => expect(calls).toBeGreaterThanOrEqual(3));
    await waitFor(() => expect(screen.getByTestId('ad-ad-p')).toHaveTextContent('ready'));
    expect(client.getQueryData<CampaignDetail>(queryKeys.campaigns.detail(campaign.id))?.ads[0].mediaStatus).toBe(
      'ready',
    );
    // Stop condition: no more requests once nothing is processing.
    const settledCalls = calls;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(calls).toBe(settledCalls);
    expect(states.some((s) => s.polling)).toBe(true);
    expect(states.at(-1)?.polling).toBe(false);
  });

  it('gives up after maxPolls and reports timedOut', async () => {
    let calls = 0;
    server.use(
      http.get(url(API_ROUTES.campaigns.ads(':id')), () => {
        calls += 1;
        return HttpResponse.json([processingAd]);
      }),
    );
    const states: Array<{ polling: boolean; timedOut: boolean }> = [];
    renderWithApp(
      <PollHarness campaign={campaign} intervalMs={30} maxPolls={3} onState={(s) => states.push(s)} />,
      { authenticated: true },
    );
    await waitFor(() => expect(states.at(-1)?.timedOut).toBe(true));
    const stopped = calls;
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(calls).toBe(stopped);
    expect(calls).toBeLessThanOrEqual(4);
  });

  it('does not poll at all when nothing is processing', async () => {
    let calls = 0;
    server.use(
      http.get(url(API_ROUTES.campaigns.ads(':id')), () => {
        calls += 1;
        return HttpResponse.json(campaignDetailFixture.ads);
      }),
    );
    renderWithApp(<PollHarness campaign={campaignDetailFixture} intervalMs={20} onState={() => {}} />, {
      authenticated: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(calls).toBe(0);
  });
});
