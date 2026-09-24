export interface CsvColumn<T> {
  key: keyof T | string;
  header: string;
  /** Optional formatter; defaults to String(value). */
  format?: (row: T) => string | number | null | undefined;
}

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'number' ? String(value) : String(value);
  // Quote when the cell contains a delimiter, quote, or line break (RFC 4180).
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Build a UTF-8 CSV string (CRLF line endings, header row first). */
export function toCsv<T extends object>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const header = columns.map((c) => escapeCell(c.header)).join(',');
  const lines = rows.map((row) =>
    columns
      .map((column) => {
        const value = column.format ? column.format(row) : (row as Record<string, unknown>)[column.key as string];
        return escapeCell(value);
      })
      .join(','),
  );
  return [header, ...lines].join('\r\n');
}

/** Trigger a browser download of CSV content. Prefixes a BOM so Excel detects UTF-8 (Ethiopic text). */
export function downloadCsv(fileName: string, csv: string): void {
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName.endsWith('.csv') ? fileName : `${fileName}.csv`;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** File-system-safe slug for downloads. */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'export';
}
