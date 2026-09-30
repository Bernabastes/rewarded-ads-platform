import type { DataExportItem } from '@rap/shared';
import { DataExportStatus } from '@rap/shared';

export function isExportFinal(item: DataExportItem | null | undefined): boolean {
  return item?.status === DataExportStatus.ready || item?.status === DataExportStatus.failed;
}

export function isExportInProgress(item: DataExportItem | null | undefined): boolean {
  return item?.status === DataExportStatus.pending || item?.status === DataExportStatus.processing;
}

/** The export to show: the newest one (the API lists newest first; be defensive and sort anyway). */
export function latestExport(items: DataExportItem[] | undefined): DataExportItem | null {
  if (!items?.length) return null;
  return [...items].sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime())[0];
}

/** A ready export is downloadable while its presigned link and the archive itself are still valid. */
export function exportDownloadable(item: DataExportItem | null | undefined, now: Date = new Date()): boolean {
  if (!item || item.status !== DataExportStatus.ready || !item.downloadUrl) return false;
  if (item.expiresAt && new Date(item.expiresAt).getTime() <= now.getTime()) return false;
  return true;
}

export interface PollExportDeps {
  fetchExport(id: string): Promise<DataExportItem>;
  sleep?(ms: number): Promise<void>;
  /** Default 20 attempts x 2 s (dev exports finish in ~1 s; production archives take longer). */
  maxAttempts?: number;
  intervalMs?: number;
  onUpdate?(item: DataExportItem): void;
}

/**
 * Polls `GET /users/me/data-export/:id` until the archive is `ready` or `failed`. Resolves with the last
 * seen item when the budget runs out (the screen keeps showing "preparing" and refetches on focus).
 */
export async function pollExport(id: string, deps: PollExportDeps): Promise<DataExportItem> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const attempts = deps.maxAttempts ?? 20;
  const interval = deps.intervalMs ?? 2000;
  let last: DataExportItem | null = null;
  for (let i = 0; i < attempts; i++) {
    last = await deps.fetchExport(id);
    deps.onUpdate?.(last);
    if (isExportFinal(last)) return last;
    await sleep(interval);
  }
  return last as DataExportItem;
}

/** Human size: 765 B, 12.4 KB, 3.1 MB. */
export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
