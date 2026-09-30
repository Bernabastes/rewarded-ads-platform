import type { DataExportItem } from '@rap/shared';

import { exportDownloadable, formatBytes, isExportFinal, isExportInProgress, latestExport, pollExport } from '../dataExport';

const item = (overrides: Partial<DataExportItem> = {}): DataExportItem => ({
  id: 'e-1',
  status: 'pending',
  requestedAt: '2026-09-29T14:32:30.103Z',
  completedAt: null,
  expiresAt: null,
  sizeBytes: null,
  downloadUrl: null,
  downloadExpiresInSeconds: null,
  error: null,
  ...overrides,
});

describe('data export polling', () => {
  it('polls until the archive is ready and reports every intermediate state', async () => {
    const states: DataExportItem[] = [item(), item({ status: 'processing' }), item({ status: 'ready', downloadUrl: 'http://minio.test/a.json.gz', sizeBytes: 765 })];
    let call = 0;
    const seen: string[] = [];
    const result = await pollExport('e-1', {
      fetchExport: async () => states[Math.min(call++, states.length - 1)],
      sleep: async () => undefined,
      onUpdate: (it) => seen.push(it.status),
    });
    expect(result.status).toBe('ready');
    expect(seen).toEqual(['pending', 'processing', 'ready']);
    expect(call).toBe(3);
  });

  it('stops on failure and returns the last item when the budget runs out', async () => {
    const failed = await pollExport('e-1', { fetchExport: async () => item({ status: 'failed', error: 'boom' }), sleep: async () => undefined });
    expect(failed.status).toBe('failed');

    let calls = 0;
    const stuck = await pollExport('e-1', {
      fetchExport: async () => {
        calls++;
        return item({ status: 'processing' });
      },
      sleep: async () => undefined,
      maxAttempts: 3,
    });
    expect(stuck.status).toBe('processing');
    expect(calls).toBe(3);
  });

  it('classifies states and picks the newest export', () => {
    expect(isExportInProgress(item())).toBe(true);
    expect(isExportInProgress(item({ status: 'processing' }))).toBe(true);
    expect(isExportFinal(item({ status: 'ready' }))).toBe(true);
    expect(isExportFinal(item({ status: 'failed' }))).toBe(true);
    expect(isExportFinal(null)).toBe(false);
    const older = item({ id: 'old', requestedAt: '2026-09-01T00:00:00.000Z' });
    expect(latestExport([older, item()])?.id).toBe('e-1');
    expect(latestExport([])).toBeNull();
  });

  it('only offers the download while the link and archive are valid', () => {
    const now = new Date('2026-09-29T15:00:00Z');
    const ready = item({ status: 'ready', downloadUrl: 'http://x', expiresAt: '2026-10-06T14:32:31.151Z' });
    expect(exportDownloadable(ready, now)).toBe(true);
    expect(exportDownloadable({ ...ready, expiresAt: '2026-09-29T14:00:00Z' }, now)).toBe(false);
    expect(exportDownloadable({ ...ready, downloadUrl: null }, now)).toBe(false);
    expect(exportDownloadable(item(), now)).toBe(false);
  });

  it('formats sizes for humans', () => {
    expect(formatBytes(765)).toBe('765 B');
    expect(formatBytes(12_700)).toBe('12.4 KB');
    expect(formatBytes(3.1 * 1024 * 1024)).toBe('3.1 MB');
    expect(formatBytes(null)).toBe('');
  });
});
