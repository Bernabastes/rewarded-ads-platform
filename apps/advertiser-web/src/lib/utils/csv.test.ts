import { describe, expect, it, vi } from 'vitest';
import { downloadCsv, slugify, toCsv } from './csv';

describe('toCsv', () => {
  const rows = [
    { date: '2026-09-01', title: 'ቡና ታይም — Morning Roast', rawViews: 50, spendEtb: 12.5, note: 'has, comma' },
    { date: '2026-09-02', title: 'Quote "test"', rawViews: 0, spendEtb: 0, note: 'line\nbreak' },
  ];

  it('writes a header row and RFC 4180-quoted cells with CRLF line endings', () => {
    const csv = toCsv(rows, [
      { key: 'date', header: 'Date' },
      { key: 'title', header: 'Campaign' },
      { key: 'rawViews', header: 'Raw views' },
      { key: 'note', header: 'Note' },
    ]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Date,Campaign,Raw views,Note');
    expect(lines[1]).toBe('2026-09-01,ቡና ታይም — Morning Roast,50,"has, comma"');
    expect(lines[2]).toBe('2026-09-02,"Quote ""test""",0,"line\nbreak"');
    expect(lines).toHaveLength(3);
  });

  it('supports custom formatters and null values', () => {
    const csv = toCsv(rows, [
      { key: 'spend', header: 'Spend (ETB)', format: (r) => r.spendEtb.toFixed(2) },
      { key: 'missing', header: 'Missing' },
    ]);
    expect(csv).toBe('Spend (ETB),Missing\r\n12.50,\r\n0.00,');
  });

  it('handles no rows', () => {
    expect(toCsv([], [{ key: 'a', header: 'A' }])).toBe('A');
  });
});

describe('downloadCsv', () => {
  it('creates a BOM-prefixed blob and clicks a temporary anchor', () => {
    const createObjectURL = vi.fn(() => 'blob:csv');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    downloadCsv('report', 'a,b');

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = (createObjectURL.mock.calls as unknown as Array<[Blob]>)[0]![0];
    expect(blob.type).toBe('text/csv;charset=utf-8');
    expect(blob.size).toBe('\uFEFFa,b'.length + 2); // BOM is 3 bytes in UTF-8
    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector('a[download]')).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe('slugify', () => {
  it('keeps Ethiopic letters and collapses punctuation', () => {
    expect(slugify('ቡና ታይም — Morning Roast!')).toBe('ቡና-ታይም-morning-roast');
    expect(slugify('   ')).toBe('export');
  });
});
