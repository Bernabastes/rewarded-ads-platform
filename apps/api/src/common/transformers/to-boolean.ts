import { Transform } from 'class-transformer';

const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'off', '']);

/**
 * Parses a query-string boolean. `@Type(() => Boolean)` must NOT be used for query params: it calls
 * `Boolean("false")`, which is `true`. Unknown strings are passed through so `@IsBoolean()` rejects them.
 */
export function parseBooleanParam(value: unknown): boolean | unknown {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (TRUE_VALUES.has(normalized)) return true;
    if (FALSE_VALUES.has(normalized)) return false;
  }
  return value;
}

/** Property decorator for optional boolean query parameters (`?resolved=false` -> `false`). */
export function ToBoolean(): PropertyDecorator {
  return Transform(({ value }) => (value === undefined || value === null ? value : parseBooleanParam(value)));
}
