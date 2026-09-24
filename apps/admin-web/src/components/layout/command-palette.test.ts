import { describe, expect, it } from 'vitest';
import { commandFilter } from './command-palette';

describe('commandFilter', () => {
  it('ranks label prefix > label substring > keyword substring > scattered words, and hides non-matches', () => {
    expect(commandFilter('Audit log', 'audit', ['Every admin decision', 'System'])).toBe(1);
    expect(commandFilter('Platform config', 'config', [])).toBe(0.8);
    expect(commandFilter('Withdrawals', 'payout', ['Payout queue & dual approval', 'Finance'])).toBe(0.5);
    expect(commandFilter('Coin adjustments', 'manual finance', ['Two-step manual credits', 'Finance'])).toBe(0.3);
    expect(commandFilter('Fraud', 'audit', ['Flags, rings, metrics', 'Risk'])).toBe(0);
  });

  it('shows everything for an empty query and is case-insensitive', () => {
    expect(commandFilter('Users', '')).toBe(1);
    expect(commandFilter('Users', '  USE  ')).toBe(1);
  });
});
