import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { adminSuper, adminSupport } from '@/test/msw/fixtures';
import { renderWithProviders } from '@/test/utils';
import { CommandPalette } from './command-palette';

describe('CommandPalette layout (F8) and Phase 4A entries', () => {
  it('pins the search input outside the scrolling results list so it can never scroll away', async () => {
    renderWithProviders(<CommandPalette open onOpenChange={vi.fn()} />, { admin: adminSuper, route: '/config' });
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByPlaceholderText(/jump to a page/i);
    const list = within(dialog).getByTestId('palette-list');
    const inputRow = within(dialog).getByTestId('palette-input-row');

    // the input row is a sibling ABOVE the list, not inside it
    expect(list.contains(input)).toBe(false);
    expect(inputRow.contains(input)).toBe(true);
    expect(inputRow.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(inputRow.parentElement).toBe(list.parentElement);

    // only the list scrolls; the input row is a fixed-height, non-scrolling flex child
    expect(list.className).toMatch(/overflow-y-auto/);
    expect(inputRow.className).toMatch(/shrink-0/);
    expect(inputRow.className).not.toMatch(/overflow/);
    // no ancestor between the list and the dialog content scrolls (the old bug: the dialog body was the scroller)
    let node: HTMLElement | null = list.parentElement;
    while (node && node !== dialog) {
      expect(node.className).not.toMatch(/overflow-y-auto/);
      node = node.parentElement;
    }
    expect(input).toHaveFocus();
  });

  it('offers the new pages with their g-shortcuts and the run-rules action to a super admin', async () => {
    renderWithProviders(<CommandPalette open onOpenChange={vi.fn()} />, { admin: adminSuper, route: '/' });
    const dialog = await screen.findByRole('dialog');
    for (const label of ['KYC queue', 'Alerts', 'Referrals', 'Deletion requests', 'Run alert rules now']) {
      expect(within(dialog).getByText(label)).toBeInTheDocument();
    }
    const kyc = within(dialog).getByText('KYC queue').closest('[cmdk-item]')!;
    expect(kyc).toHaveTextContent('GK');
    const alerts = within(dialog).getByText('Alerts').closest('[cmdk-item]')!;
    expect(alerts).toHaveTextContent('GT');
  });

  it('hides run-rules from support and matches Phase 4A keywords such as "fayda"', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommandPalette open onOpenChange={vi.fn()} />, { admin: adminSupport, route: '/' });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText('Run alert rules now')).not.toBeInTheDocument();
    expect(within(dialog).getByText('Deletion requests')).toBeInTheDocument();
    await user.type(within(dialog).getByPlaceholderText(/jump to a page/i), 'fayda');
    expect(within(dialog).getByText('KYC queue')).toBeInTheDocument();
    expect(within(dialog).queryByText('Fraud')).not.toBeInTheDocument();
  });
});
