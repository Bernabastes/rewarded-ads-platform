/** Common wire types shared by every endpoint. */

/** ISO-8601 UTC timestamp, e.g. "2026-09-24T06:37:23.799Z". */
export type IsoDateTime = string;
/** Calendar date "YYYY-MM-DD". */
export type IsoDate = string;
/** RFC 4122 UUID. */
export type Uuid = string;

export interface PaginationQuery {
  /** 1-based page number (default 1). */
  page?: number;
  /** Items per page (default 20, max 100). */
  limit?: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
}

export interface Paginated<T, M extends PaginationMeta = PaginationMeta> {
  data: T[];
  meta: M;
}

export interface DateRangeQuery {
  /** Inclusive start (ISO date or datetime). Defaults to 30 days ago. */
  from?: string;
  /** Inclusive end (ISO date or datetime). Defaults to now. */
  to?: string;
}

/** One bucket of a daily time series. */
export interface DailyPoint {
  /** "YYYY-MM-DD" (UTC). */
  date: IsoDate;
  [metric: string]: number | string;
}
