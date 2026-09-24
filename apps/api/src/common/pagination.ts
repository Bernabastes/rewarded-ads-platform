import { ApiPropertyOptional } from '@nestjs/swagger';
import type { Paginated, PaginationMeta } from '@rap/shared';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PaginationQueryDto {
  /** 1-based page number. */
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  /** Items per page (max 100). */
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

export function pageArgs(q: { page?: number; limit?: number }) {
  const page = Math.max(1, q.page ?? 1);
  const limit = Math.min(100, Math.max(1, q.limit ?? 20));
  return { page, limit, skip: (page - 1) * limit, take: limit };
}

export function paginated<T, M extends PaginationMeta = PaginationMeta>(
  data: T[],
  total: number,
  q: { page: number; limit: number },
  extraMeta?: Omit<M, keyof PaginationMeta>,
): Paginated<T, M> {
  return { data, meta: { page: q.page, limit: q.limit, total, ...(extraMeta ?? {}) } as M };
}
