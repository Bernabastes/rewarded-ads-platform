import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithApp } from '@/test/render';
import { AppShell } from './app-shell';

/** Finding F7: printing an invoice must not include the sidebar, top bar, theme toggle, avatar or toasts. */
// The full app shell (command palette, wallet chip, profile sync) is slow to mount on a cold parallel run.
describe('print styles (F7)', { timeout: 20_000 }, () => {
  it('hides the app chrome in @media print', () => {
    const css = readFileSync(resolve(__dirname, '../../styles/globals.css'), 'utf8');
    const printBlock = css.slice(css.indexOf('@media print'));
    expect(printBlock).toContain('.print-hidden');
    expect(printBlock).toContain('[data-app-chrome]');
    expect(printBlock).toContain('[data-sonner-toaster]');
    expect(printBlock).toMatch(/display:\s*none\s*!important/);
    expect(css).toContain('@page');
  });

  it('marks the sidebar and the top bar as chrome so they disappear when printing', async () => {
    renderWithApp(
      <AppShell>
        <article>Invoice body</article>
      </AppShell>,
      { authenticated: true, route: '/billing/invoices/inv-1' },
    );
    expect(await screen.findByText('Invoice body')).toBeInTheDocument();
    const chrome = document.querySelectorAll('[data-app-chrome]');
    expect(chrome).toHaveLength(2);
    for (const el of chrome) expect(el).toHaveClass('print-hidden');
    expect(document.querySelector('aside')).toHaveClass('print-hidden');
    expect(document.querySelector('header')).toHaveClass('print-hidden');
    // The theme toggle and account menu live inside the hidden header.
    expect(screen.getByRole('button', { name: 'Account menu' }).closest('header')).toHaveClass('print-hidden');
  });
});
