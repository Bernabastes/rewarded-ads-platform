import { Global, Injectable, Module } from '@nestjs/common';
import { type ActorType, Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface AuditEntry {
  actorType: ActorType;
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

/**
 * Append-only audit trail. Every admin mutation and every money-relevant system action writes here,
 * inside the same transaction as the change when a transaction client is supplied.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    return db.auditLog.create({
      data: {
        actorType: entry.actorType,
        actorId: entry.actorId ?? null,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        beforeState: toJson(entry.before),
        afterState: toJson(entry.after),
        metadata: toJson(entry.metadata),
        ipAddress: entry.ipAddress ?? null,
      },
    });
  }
}

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined || value === null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
