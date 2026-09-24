import { ErrorCode } from '@rap/shared';
import { describe, expect, it } from 'vitest';
import { ApiError, ClientErrorCode, describeApiError, mapValidationErrors, prettifyServerMessage } from './errors';

const validationError = new ApiError({
  statusCode: 400,
  code: ErrorCode.VALIDATION_ERROR,
  message: 'Validation failed',
  details: [
    { field: 'title', messages: ['title must be longer than or equal to 3 characters'] },
    { field: 'budgetEtb', messages: ['budgetEtb must not be less than 1', 'budgetEtb must be a number'] },
    { field: 'targetActionType', messages: ['targetActionType must be one of the following values: video_view, survey, app_install'] },
  ],
});

describe('mapValidationErrors', () => {
  it('maps known fields to their first message and collects the rest as form errors', () => {
    const { fieldErrors, formErrors } = mapValidationErrors(validationError, ['title', 'budgetEtb']);
    expect(fieldErrors).toEqual({
      title: 'Title must be longer than or equal to 3 characters',
      budgetEtb: 'Budget ETB must not be less than 1',
    });
    expect(formErrors).toEqual(['Target action type must be one of the following values: video_view, survey, app_install']);
  });

  it('translates API field names through the field map', () => {
    const { fieldErrors, formErrors } = mapValidationErrors(validationError, ['name'], { title: 'name' });
    expect(fieldErrors).toEqual({ name: 'Title must be longer than or equal to 3 characters' });
    expect(formErrors).toHaveLength(2);
  });

  it('ignores non-validation and non-API errors', () => {
    expect(mapValidationErrors(new Error('boom'), ['title'])).toEqual({ fieldErrors: {}, formErrors: [] });
    const other = new ApiError({ statusCode: 409, code: ErrorCode.CONFLICT, message: 'conflict', details: [{ field: 'title', messages: ['x'] }] });
    expect(mapValidationErrors(other, ['title'])).toEqual({ fieldErrors: {}, formErrors: [] });
  });
});

describe('prettifyServerMessage', () => {
  it('turns class-validator property prefixes into readable labels', () => {
    expect(prettifyServerMessage('costPerActionEtb must not be less than 0.01', 'costPerActionEtb')).toBe(
      'Cost per action ETB must not be less than 0.01',
    );
    expect(prettifyServerMessage('Custom message', 'field')).toBe('Custom message');
  });
});

describe('describeApiError', () => {
  it('describes known codes without leaking the server message', () => {
    const error = new ApiError({ statusCode: 422, code: ErrorCode.INSUFFICIENT_WALLET_BALANCE, message: 'internal wording' });
    const described = describeApiError(error);
    expect(described.title).toBe('Not enough funds in your wallet');
    expect(described.description).not.toContain('internal wording');
  });

  it('includes retry-after seconds for rate limits', () => {
    const error = new ApiError({ statusCode: 429, code: ErrorCode.RATE_LIMITED, message: 'slow down', details: { retryAfterSeconds: 42 } });
    expect(describeApiError(error).description).toBe('Please try again in 42s.');
    expect(error.retryAfterSeconds).toBe(42);
  });

  it('falls back sensibly for unknown codes, 5xx and network errors', () => {
    expect(describeApiError(new ApiError({ statusCode: 418, code: 'TEAPOT' as never, message: 'x' })).title).toBe('Something went wrong');
    expect(describeApiError(new ApiError({ statusCode: 503, code: 'WHATEVER' as never, message: 'x' })).title).toBe('Something went wrong on our side');
    expect(describeApiError(new TypeError('Failed to fetch')).title).toBe('You appear to be offline');
    expect(ApiError.fromUnknown('nope').code).toBe(ClientErrorCode.UNKNOWN_ERROR);
  });
});
