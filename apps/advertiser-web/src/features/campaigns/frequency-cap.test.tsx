import { PLATFORM_DEFAULTS } from '@rap/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { campaignDetailFixture } from '@/test/mocks/fixtures';
import { renderWithApp } from '@/test/render';
import { describeFrequencyCap, FREQUENCY_CAP_OPTIONS } from './frequency-cap';
import { detailsSchema, frequencyCapSchema } from './wizard/schemas';
import { DEFAULT_DETAILS, DetailsStep, detailsFromCampaign } from './wizard/step-details';

describe('frequency cap validation', () => {
  it('offers exactly the platform range and defaults to the platform default', () => {
    expect(FREQUENCY_CAP_OPTIONS).toEqual([1, 2, 3, 4, 5]);
    expect(DEFAULT_DETAILS.frequencyCapPerUserPerDay).toBe(PLATFORM_DEFAULTS.DEFAULT_FREQUENCY_CAP);
  });

  it.each([1, 2, 3, 4, 5])('accepts %i', (cap) => {
    expect(frequencyCapSchema.safeParse(cap).success).toBe(true);
  });

  it.each([0, 6, -1, 2.5, Number.NaN])('rejects %s', (cap) => {
    const result = frequencyCapSchema.safeParse(cap);
    expect(result.success).toBe(false);
  });

  it('is required on the details step schema with a friendly range message', () => {
    const result = detailsSchema.safeParse({ ...DEFAULT_DETAILS, title: 'Valid title', frequencyCapPerUserPerDay: 9 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['frequencyCapPerUserPerDay']);
      expect(result.error.issues[0]?.message).toContain('5 views per person per day');
    }
  });

  it('maps an existing campaign into the form and describes the cap', () => {
    expect(detailsFromCampaign({ ...campaignDetailFixture, frequencyCapPerUserPerDay: 3 }).frequencyCapPerUserPerDay).toBe(3);
    expect(describeFrequencyCap(1)).toBe('Once per person per day');
    expect(describeFrequencyCap(4)).toBe('Up to 4 times per person per day');
  });
});

describe('DetailsStep frequency cap control', { timeout: 20_000 }, () => {
  it('renders a 1–5 radio group with the default selected and submits the chosen value', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderWithApp(<DetailsStep defaultValues={{ ...DEFAULT_DETAILS, title: 'Buna Time' }} onSubmit={onSubmit} />, {
      authenticated: true,
    });

    const group = screen.getByRole('radiogroup', { name: 'Max views per person per day' });
    expect(group).toBeInTheDocument();
    const radios = screen.getAllByRole('radio', { name: /per person per day/ });
    expect(radios).toHaveLength(5);
    expect(screen.getByRole('radio', { name: /^1 view per person per day \(recommended\)/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByText(/Once per person per day\./)).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /^2 views per person per day/ }));
    expect(screen.getByRole('radio', { name: /^2 views per person per day/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/Up to 2 times per person per day\./)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Continue to budget/ }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ title: 'Buna Time', frequencyCapPerUserPerDay: 2 });
  });

  it('moves the selection with the arrow keys and clamps at the platform maximum', async () => {
    const user = userEvent.setup();
    renderWithApp(
      <DetailsStep defaultValues={{ ...DEFAULT_DETAILS, title: 'Buna Time', frequencyCapPerUserPerDay: 4 }} onSubmit={() => {}} />,
      { authenticated: true },
    );
    const four = screen.getByRole('radio', { name: /^4 views per person per day/ });
    four.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: /^5 views per person per day/ })).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: /^5 views per person per day/ })).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: /^4 views per person per day/ })).toHaveAttribute('aria-checked', 'true');
  });
});
