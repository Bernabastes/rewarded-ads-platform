import { BANNED_TOPICS } from '@rap/shared';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { AdReview } from '@/lib/api/types';
import { allChecks, type Checks, emptyChecks } from '@/lib/domain/review-rules';
import { adminReviewer, correctedAd, failedMediaAd, pendingAd, processingAd } from '@/test/msw/fixtures';
import { renderWithProviders } from '@/test/utils';
import { ReviewPane } from './review-pane';

function Harness({ onApprove, onReject, initial = emptyChecks(), ad = pendingAd, onReprocessMedia }: { onApprove: () => void; onReject: () => void; initial?: Checks; ad?: AdReview; onReprocessMedia?: () => void }) {
  const [checks, setChecks] = useState<Checks>(initial);
  const [notes, setNotes] = useState('');
  const [flagged, setFlagged] = useState<Array<(typeof BANNED_TOPICS)[number]['key']>>([]);
  return (
    <ReviewPane
      ad={ad}
      mode="pending"
      checks={checks}
      onChecksChange={setChecks}
      notes={notes}
      onNotesChange={setNotes}
      flagged={flagged}
      onToggleFlagged={(k) => {
        setFlagged((f) => (f.includes(k) ? f.filter((x) => x !== k) : [...f, k]));
        setChecks((c) => ({ ...c, [k]: false }));
      }}
      onApprove={onApprove}
      onReject={onReject}
      canDecide
      onReprocessMedia={onReprocessMedia}
    />
  );
}

describe('ReviewPane banned-topics gating', () => {
  it('keeps Approve disabled until every banned topic is ticked, then enables it', async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    renderWithProviders(<Harness onApprove={onApprove} onReject={vi.fn()} />, { admin: adminReviewer, route: '/review/ad-1' });

    const approve = () => screen.getByRole('button', { name: /approve/i });
    expect(approve()).toBeDisabled();
    expect(screen.getByText(`0/${BANNED_TOPICS.length} confirmed absent`)).toBeInTheDocument();

    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(BANNED_TOPICS.length);
    for (const box of boxes.slice(0, -1)) await user.click(box);
    expect(approve()).toBeDisabled();
    expect(screen.getByText(`${BANNED_TOPICS.length - 1}/${BANNED_TOPICS.length} confirmed absent`)).toBeInTheDocument();

    await user.click(boxes[boxes.length - 1]!);
    expect(approve()).toBeEnabled();
    await user.click(approve());
    expect(onApprove).toHaveBeenCalledTimes(1);
  }, 20_000);

  it('"Tick all" completes the checklist and marking a topic as present blocks approval again', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness onApprove={vi.fn()} onReject={vi.fn()} />, { admin: adminReviewer, route: '/review/ad-1' });
    await user.click(screen.getByRole('button', { name: /tick all/i }));
    const approve = () => screen.getByRole('button', { name: /approve/i });
    expect(approve()).toBeEnabled();
    await user.click(screen.getByRole('button', { name: /mark "alcohol" as present/i }));
    expect(approve()).toBeDisabled();
    expect(screen.getByText(`${BANNED_TOPICS.length - 1}/${BANNED_TOPICS.length} confirmed absent`)).toBeInTheDocument();
  });

  it('shows the attention question with the correct answer highlighted (admin-only) and opens reject', async () => {
    const user = userEvent.setup();
    const onReject = vi.fn();
    renderWithProviders(<Harness onApprove={vi.fn()} onReject={onReject} initial={allChecks(true)} />, { admin: adminReviewer, route: '/review/ad-1' });
    expect(screen.getByText('What was advertised?', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('correct')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /reject/i }));
    expect(onReject).toHaveBeenCalledTimes(1);
  });
});

describe('ReviewPane media pipeline gating (MEDIA_NOT_READY)', () => {
  it('keeps Approve disabled while the media is processing even with a complete checklist, and offers reprocessing', async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    const onReprocess = vi.fn();
    renderWithProviders(<Harness onApprove={onApprove} onReject={vi.fn()} initial={allChecks(true)} ad={processingAd} onReprocessMedia={onReprocess} />, { admin: adminReviewer, route: '/review/ad-processing' });
    expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled();
    expect(screen.getByTestId('media-not-ready')).toHaveTextContent(/still being probed/);
    expect(screen.getAllByTestId('media-status')[0]).toHaveTextContent('processing');
    await user.click(screen.getByTestId('reprocess-media'));
    expect(onReprocess).toHaveBeenCalledTimes(1);
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('explains a failed pipeline with the ffprobe error and still allows rejecting', () => {
    renderWithProviders(<Harness onApprove={vi.fn()} onReject={vi.fn()} initial={allChecks(true)} ad={failedMediaAd} onReprocessMedia={vi.fn()} />, { admin: adminReviewer, route: '/review/ad-failed' });
    expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled();
    expect(screen.getByTestId('media-not-ready')).toHaveTextContent(/moov atom not found/);
    expect(screen.getByRole('button', { name: /reject/i })).toBeEnabled();
  });

  it('allows approval for duration-corrected media and shows declared → probed plus the probe details', () => {
    renderWithProviders(<Harness onApprove={vi.fn()} onReject={vi.fn()} initial={allChecks(true)} ad={correctedAd} />, { admin: adminReviewer, route: '/review/ad-corrected' });
    expect(screen.getByRole('button', { name: /approve/i })).toBeEnabled();
    expect(screen.queryByTestId('media-not-ready')).not.toBeInTheDocument();
    expect(screen.getByText(/declared 15s → 18s/)).toBeInTheDocument();
    expect(screen.getAllByText(/1280×720/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/h264/).length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('media-status')[0]).toHaveTextContent('duration corrected');
  });
});
