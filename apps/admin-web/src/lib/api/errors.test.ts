import { describe, expect, it, vi } from 'vitest';
import { ApiError, applyFieldErrors, describeError, getFieldErrors } from './errors';

const validation = new ApiError({
  statusCode: 400,
  code: 'VALIDATION_ERROR',
  message: 'Validation failed',
  details: [
    { field: 'reason', messages: ['reason must be longer than or equal to 5 characters'] },
    { field: 'bannedTopicsChecklist.checks', messages: ['checks must be an object'] },
  ],
});

describe('field error mapping', () => {
  it('extracts { field, messages } pairs from VALIDATION_ERROR details', () => {
    expect(getFieldErrors(validation)).toEqual([
      { field: 'reason', messages: ['reason must be longer than or equal to 5 characters'] },
      { field: 'bannedTopicsChecklist.checks', messages: ['checks must be an object'] },
    ]);
  });

  it('ignores non-validation errors and malformed details', () => {
    expect(getFieldErrors(new ApiError({ statusCode: 409, code: 'CONFLICT', message: 'x' }))).toEqual([]);
    expect(getFieldErrors(new ApiError({ statusCode: 400, code: 'VALIDATION_ERROR', message: 'x', details: { missing: ['alcohol'] } }))).toEqual([]);
    expect(getFieldErrors(new Error('boom'))).toEqual([]);
  });

  it('maps nested fields onto their root form field when only the root is known', () => {
    const setError = vi.fn();
    const applied = applyFieldErrors(validation, setError, ['reason', 'bannedTopicsChecklist']);
    expect(applied).toEqual(['reason', 'bannedTopicsChecklist']);
    expect(setError).toHaveBeenCalledWith('reason', { type: 'server', message: 'reason must be longer than or equal to 5 characters' });
    expect(setError).toHaveBeenCalledWith('bannedTopicsChecklist', { type: 'server', message: 'checks must be an object' });
  });

  it('skips fields the form does not know about', () => {
    const setError = vi.fn();
    expect(applyFieldErrors(validation, setError, ['note'])).toEqual([]);
    expect(setError).not.toHaveBeenCalled();
  });
});

describe('describeError', () => {
  it('branches on code, not message', () => {
    expect(describeError(new ApiError({ statusCode: 409, code: 'DUAL_APPROVAL_SAME_ADMIN', message: 'server text' }))).toBe('A different admin must provide the second approval.');
    expect(describeError(new ApiError({ statusCode: 403, code: 'ADJUSTMENT_SELF_APPROVAL_FORBIDDEN', message: 'x' }))).toMatch(/cannot approve your own/);
  });

  it('renders validation details and the banned-topics "missing" hint', () => {
    expect(describeError(validation)).toContain('reason: reason must be longer');
    expect(describeError(new ApiError({ statusCode: 400, code: 'VALIDATION_ERROR', message: 'x', details: { missing: ['alcohol', 'weapons'] } }))).toBe('Missing checklist items: alcohol, weapons');
  });

  it('includes retryAfterSeconds for rate limits and handles unknown errors', () => {
    expect(describeError(new ApiError({ statusCode: 429, code: 'RATE_LIMITED', message: 'x', details: { retryAfterSeconds: 12 } }))).toBe('Too many requests. Try again in 12s.');
    expect(describeError(new Error('kaboom'))).toBe('kaboom');
    expect(describeError('???')).toBe('Unexpected error.');
    expect(describeError(ApiError.network())).toMatch(/Cannot reach the API/);
  });

  it('Phase 5b: explains why a flagged reward cannot be released / a campaign cannot be approved', () => {
    expect(describeError(new ApiError({ statusCode: 422, code: 'CAMPAIGN_NOT_CHARGEABLE', message: 'x', details: { campaignStatus: 'completed' } }))).toMatch(/no longer live.*flag was left open/i);
    expect(describeError(new ApiError({ statusCode: 422, code: 'CAMPAIGN_UNDERFUNDED', message: 'x' }))).toMatch(/reservation does not cover/i);
  });
});
