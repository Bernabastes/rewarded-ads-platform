import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { type AuthSubjectType, Prisma } from '@prisma/client';
import { ErrorCode, IDEMPOTENCY_KEY_HEADER, IDEMPOTENT_REPLAYED_HEADER } from '@rap/shared';
import type { Response } from 'express';
import { from, type Observable, of, switchMap, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { AppConfig } from '../../config/app-config';
import { SecurityLogger } from '../../infra/logger/logger.module';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { RequestWithAuth } from '../decorators/auth.decorators';
import { AppException } from '../errors/app.exception';
import { serializeValue } from '../interceptors/serialize.interceptor';
import { sha256 } from '../utils';

export const IDEMPOTENT_KEY = 'idempotency:enabled';

/** Marks a money POST handler as honouring the `Idempotency-Key` header. */
export const Idempotent = () => SetMetadata(IDEMPOTENT_KEY, true);

const KEY_PATTERN = /^[A-Za-z0-9_\-:.]{1,128}$/;

interface Actor {
  actorType: AuthSubjectType;
  actorId: string;
}

type Claim = { kind: 'run'; id: string } | { kind: 'replay'; statusCode: number; body: unknown };

/** Stable hash of the request identity: method + path + canonical (key-sorted) JSON body. */
export function requestFingerprint(method: string, path: string, body: unknown): string {
  return sha256(`${method.toUpperCase()} ${path}\n${canonicalJson(body ?? {})}`);
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(',')}}`;
}

/**
 * Idempotency protocol for money POSTs (withdrawals, top-ups, coin adjustments, offer completions):
 *
 *  - no header                                  -> normal request (backwards compatible)
 *  - same key + same payload, finished          -> replay the stored response, `Idempotent-Replayed: true`
 *  - same key + same payload, still running     -> 409 IDEMPOTENCY_KEY_REUSED { inProgress: true }
 *  - same key + different payload               -> 409 IDEMPOTENCY_KEY_REUSED { inProgress: false }
 *
 * A placeholder row (status_code 0) is inserted BEFORE the handler runs so concurrent duplicates hit the unique
 * constraint instead of executing twice; only successful responses are memoised (errors delete the placeholder so
 * the client may retry with the same key). Rows expire after IDEMPOTENCY_TTL_HOURS. Keys are scoped per actor.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly security: SecurityLogger,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const enabled = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!enabled) return next.handle();

    const req = context.switchToHttp().getRequest<RequestWithAuth>();
    const res = context.switchToHttp().getResponse<Response>();
    const rawKey = req.headers[IDEMPOTENCY_KEY_HEADER.toLowerCase()];
    const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (!key) return next.handle();
    if (!KEY_PATTERN.test(key)) {
      return throwError(() =>
        AppException.badRequest(
          ErrorCode.VALIDATION_ERROR,
          `${IDEMPOTENCY_KEY_HEADER} must be 1-128 characters of [A-Za-z0-9_-:.]`,
        ),
      );
    }
    if (!req.auth) return next.handle();

    const actor: Actor = { actorType: req.auth.subjectType, actorId: req.auth.subjectId };
    const method = req.method.toUpperCase();
    const path = (req.originalUrl ?? req.url).split('?')[0];
    const requestHash = requestFingerprint(method, path, req.body);
    const successStatus =
      this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler()) ??
      (method === 'POST' ? 201 : 200);

    return from(this.claim(key, actor, method, path, requestHash)).pipe(
      switchMap((claim) => {
        if (claim.kind === 'replay') {
          res.setHeader(IDEMPOTENT_REPLAYED_HEADER, 'true');
          res.status(claim.statusCode);
          this.security.info('idempotency.replayed', { ...actor, key, method, path });
          return of(claim.body);
        }
        return next.handle().pipe(
          switchMap((body) => from(this.complete(claim.id, successStatus, body)).pipe(map(() => body))),
          catchError((err) => from(this.release(claim.id)).pipe(switchMap(() => throwError(() => err)))),
        );
      }),
    );
  }

  private async claim(
    key: string,
    actor: Actor,
    method: string,
    path: string,
    requestHash: string,
  ): Promise<Claim> {
    const expiresAt = new Date(Date.now() + this.config.platform.idempotencyTtlHours * 3_600_000);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const row = await this.prisma.idempotencyKey.create({
          data: { key, ...actor, method, path, requestHash, expiresAt },
          select: { id: true },
        });
        return { kind: 'run', id: row.id };
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
        const existing = await this.prisma.idempotencyKey.findUnique({
          where: { actorType_actorId_key: { ...actor, key } },
        });
        if (!existing) continue; // deleted between the two statements; retry the insert once
        if (existing.expiresAt < new Date()) {
          await this.prisma.idempotencyKey.delete({ where: { id: existing.id } }).catch(() => undefined);
          continue;
        }
        if (existing.requestHash !== requestHash) {
          this.security.warn('idempotency.key_reused_different_payload', { ...actor, key, method, path });
          throw AppException.conflict(
            ErrorCode.IDEMPOTENCY_KEY_REUSED,
            `${IDEMPOTENCY_KEY_HEADER} was already used with a different request payload`,
            { key, inProgress: false },
          );
        }
        if (existing.statusCode === 0) {
          throw AppException.conflict(
            ErrorCode.IDEMPOTENCY_KEY_REUSED,
            'A request with this Idempotency-Key is still being processed',
            { key, inProgress: true },
          );
        }
        return { kind: 'replay', statusCode: existing.statusCode, body: existing.responseBody };
      }
    }
    throw AppException.conflict(ErrorCode.IDEMPOTENCY_KEY_REUSED, 'Could not claim the idempotency key', {
      key,
      inProgress: true,
    });
  }

  private async complete(id: string, statusCode: number, body: unknown) {
    const serialized = serializeValue(body);
    await this.prisma.idempotencyKey
      .update({
        where: { id },
        data: {
          statusCode,
          responseBody: serialized === undefined || serialized === null ? Prisma.JsonNull : (serialized as Prisma.InputJsonValue),
        },
      })
      .catch((err: Error) => this.security.error('idempotency.store_failed', { id, error: err.message }));
  }

  private async release(id: string) {
    await this.prisma.idempotencyKey.delete({ where: { id } }).catch(() => undefined);
  }

  /** Housekeeping (called by the hourly data-rights job): drop expired keys. */
  async purgeExpired(now = new Date()): Promise<number> {
    const result = await this.prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lt: now } } });
    return result.count;
  }
}
