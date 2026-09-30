import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { impersonationToken } from '@/test/msw/fixtures';
import { formatCountdown, impersonationStore, useImpersonation, useImpersonationCountdown } from './impersonation-store';

describe('impersonationStore (read-only "view as user" sessions)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T08:00:00.000Z'));
  });
  afterEach(() => {
    impersonationStore.end();
    vi.useRealTimers();
  });

  it('keeps the token in memory only and exposes it while active', () => {
    const res = { ...impersonationToken, expiresAt: new Date(Date.now() + 600_000).toISOString() };
    impersonationStore.start(res, 'TICKET-1');
    const state = impersonationStore.getState();
    expect(state.status).toBe('active');
    expect(state.session?.token).toBe('impersonation-token-1');
    expect(state.session?.user.phoneNumber).toBe('+251911000137');
    expect(state.session?.reason).toBe('TICKET-1');
    expect(localStorage.length).toBe(0);
    expect(Object.values(localStorage).join('')).not.toContain('impersonation-token-1');
  });

  it('expires on the timer, wipes the token and reports the countdown as mm:ss', () => {
    const res = { ...impersonationToken, expiresAt: new Date(Date.now() + 90_000).toISOString() };
    const { result } = renderHook(() => ({ state: useImpersonation(), remaining: useImpersonationCountdown() }));
    act(() => impersonationStore.start(res, 'TICKET-2'));
    expect(result.current.state.status).toBe('active');
    expect(formatCountdown(result.current.remaining)).toBe('01:30');

    act(() => vi.advanceTimersByTime(30_000));
    expect(formatCountdown(result.current.remaining)).toBe('01:00');

    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.state.status).toBe('expired');
    expect(result.current.state.session?.token).toBe('');
    expect(result.current.state.session?.user.id).toBe('user-1');
    expect(result.current.remaining).toBe(0);
  });

  it('markExpired (server 401) and end() behave like the timer / a dismissal', () => {
    impersonationStore.start({ ...impersonationToken, expiresAt: new Date(Date.now() + 600_000).toISOString() }, 'x');
    impersonationStore.markExpired();
    expect(impersonationStore.getState().status).toBe('expired');
    impersonationStore.end();
    expect(impersonationStore.getState()).toEqual({ status: 'idle', session: null });
    // ending an idle store is a no-op
    impersonationStore.end();
    expect(impersonationStore.getState().status).toBe('idle');
  });

  it('formats countdowns', () => {
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(600_000)).toBe('10:00');
    expect(formatCountdown(59_400)).toBe('01:00');
    expect(formatCountdown(1)).toBe('00:01');
  });
});
