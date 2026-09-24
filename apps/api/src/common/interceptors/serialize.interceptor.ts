import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type Observable, map } from 'rxjs';

/**
 * Normalises response payloads for the wire:
 *  - Prisma Decimal -> number (ETB amounts, 2 decimals)
 *  - BigInt -> number
 *  - Date -> ISO-8601 UTC string
 * Services can therefore return Prisma rows (with selected fields) directly.
 */
@Injectable()
export class SerializeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((data) => serializeValue(data)));
  }
}

export function serializeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Prisma.Decimal) return Number(value.toFixed(2));
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (Array.isArray(value)) return value.map(serializeValue);
  if (typeof value === 'object') {
    const anyVal = value as { toFixed?: unknown; d?: unknown; e?: unknown; s?: unknown };
    // Decimal-like objects (decimal.js) coming back from raw queries
    if (typeof anyVal.toFixed === 'function' && 'd' in anyVal && 'e' in anyVal && 's' in anyVal) {
      return Number((anyVal.toFixed as (n: number) => string)(2));
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = serializeValue(v);
    return out;
  }
  return value;
}
