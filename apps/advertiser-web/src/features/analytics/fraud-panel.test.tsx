import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { analyticsFixture } from '@/test/mocks/fixtures';
import { renderWithApp } from '@/test/render';
import { FraudFilterPanel, summarizeFraud } from './fraud-panel';

describe('summarizeFraud', () => {
  it('derives filtered counts, rate and the amount not charged', () => {
    const summary = summarizeFraud(analyticsFixture.totals, 2);
    expect(summary.filtered).toBe(75);
    expect(summary.flagged).toBe(50);
    expect(summary.rejected).toBe(25);
    expect(summary.rate).toBeCloseTo(75 / 700);
    expect(summary.savedEtb).toBe(150);
  });

  it('is zero-safe when nothing has happened yet', () => {
    const summary = summarizeFraud(
      { rawCompletions: 0, validCompletions: 0, flaggedCompletions: 0, rejectedCompletions: 0, fraudFilteredRate: 0 },
      2,
    );
    expect(summary.rate).toBe(0);
    expect(summary.savedEtb).toBe(0);
  });
});

describe('FraudFilterPanel', () => {
  it('makes the filtered completions and savings unmistakable', () => {
    renderWithApp(<FraudFilterPanel summary={summarizeFraud(analyticsFixture.totals, 2)} campaignTitle="Morning Roast" />);
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading).toHaveTextContent('We filtered 75 suspicious completions so you only pay for real attention.');
    expect(screen.getByText(/Out of/)).toHaveTextContent('700');
    expect(screen.getByText('10.7%')).toBeInTheDocument();
    expect(screen.getByText('ETB 150.00')).toBeInTheDocument();
    expect(screen.getByText('Flagged')).toBeInTheDocument();
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
  });

  it('explains the protection before any data exists', () => {
    renderWithApp(
      <FraudFilterPanel
        summary={summarizeFraud({ rawCompletions: 0, validCompletions: 0, flaggedCompletions: 0, rejectedCompletions: 0, fraudFilteredRate: 0 }, 2)}
      />,
    );
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Every completion is checked before you pay.');
  });
});
