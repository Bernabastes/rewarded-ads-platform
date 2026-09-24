import { BANNED_TOPICS } from '@rap/shared';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { allChecks, type Checks, emptyChecks } from '@/lib/domain/review-rules';
import { adminReviewer, pendingAd } from '@/test/msw/fixtures';
import { renderWithProviders } from '@/test/utils';
import { ReviewPane } from './review-pane';

function Harness({ onApprove, onReject, initial = emptyChecks() }: { onApprove: () => void; onReject: () => void; initial?: Checks }) {
  const [checks, setChecks] = useState<Checks>(initial);
  const [notes, setNotes] = useState('');
  const [flagged, setFlagged] = useState<Array<(typeof BANNED_TOPICS)[number]['key']>>([]);
  return (
    <ReviewPane
      ad={pendingAd}
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
