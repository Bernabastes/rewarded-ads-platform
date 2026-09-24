import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { campaignFixture, draftCampaignFixture } from '@/test/mocks/fixtures';
import { renderWithApp } from '@/test/render';
import { budgetProgress, CampaignCard } from './campaign-card';

describe('CampaignCard', () => {
  it('shows title, status, pricing, budget progress and verified vs raw counts', () => {
    renderWithApp(<CampaignCard campaign={campaignFixture} animated={false} />);
    const link = screen.getByRole('link', { name: /ቡና ታይም — Morning Roast launch/ });
    expect(link).toHaveAttribute('href', '/campaigns/camp-1');
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText(/Video view · ETB 2\.00 per action/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Budget spent' })).toHaveAttribute('aria-valuenow', '25');
    expect(screen.getByText('625')).toBeInTheDocument();
    expect(screen.getByText('700')).toBeInTheDocument();
    expect(screen.getByText('89%')).toBeInTheDocument();
  });

  it('renders a dash for the pass rate when nothing has completed yet', () => {
    renderWithApp(<CampaignCard campaign={draftCampaignFixture} animated={false} />);
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Budget spent' })).toHaveAttribute('aria-valuenow', '0');
  });

  it('clamps budget progress between 0 and 1', () => {
    expect(budgetProgress({ budgetEtb: 100, spentEtb: 150 })).toBe(1);
    expect(budgetProgress({ budgetEtb: 0, spentEtb: 0 })).toBe(0);
    expect(budgetProgress({ budgetEtb: 200, spentEtb: 50 })).toBe(0.25);
  });
});
