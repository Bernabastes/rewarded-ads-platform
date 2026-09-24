import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';
import { countChanges, diffJson, formatJsonValue } from './json-diff';

describe('diffJson', () => {
  it('classifies added, removed, changed and unchanged keys', () => {
    const entries = diffJson({ status: 'flagged_for_review', approvals: 1, note: null }, { status: 'pending', approvals: 2, required: 2 });
    expect(entries).toEqual([
      { path: 'approvals', kind: 'changed', before: 1, after: 2 },
      { path: 'note', kind: 'removed', before: null, after: undefined },
      { path: 'required', kind: 'added', before: undefined, after: 2 },
      { path: 'status', kind: 'changed', before: 'flagged_for_review', after: 'pending' },
    ]);
    expect(countChanges(entries)).toBe(4);
  });

  it('recurses into nested objects and compares arrays as whole values', () => {
    const entries = diffJson({ checklist: { checks: { alcohol: false }, notes: 'a' }, tags: [1, 2] }, { checklist: { checks: { alcohol: true }, notes: 'a' }, tags: [1, 2] });
    expect(entries).toEqual([
      { path: 'checklist.checks.alcohol', kind: 'changed', before: false, after: true },
      { path: 'checklist.notes', kind: 'unchanged', before: 'a', after: 'a' },
      { path: 'tags', kind: 'unchanged', before: [1, 2], after: [1, 2] },
    ]);
    expect(countChanges(entries)).toBe(1);
  });

  it('handles null / missing states (audit rows often have no beforeState)', () => {
    expect(diffJson(null, { status: 'pending' })).toEqual([{ path: 'status', kind: 'added', before: undefined, after: 'pending' }]);
    expect(diffJson(undefined, undefined)).toEqual([]);
  });

  it('formats values for display', () => {
    expect(formatJsonValue(undefined)).toBe('—');
    expect(formatJsonValue(null)).toBe('null');
    expect(formatJsonValue('x')).toBe('"x"');
    expect(formatJsonValue({ a: 1 })).toBe('{"a":1}');
  });
});

describe('toCsv', () => {
  it('escapes delimiters/quotes and guards against formula injection', () => {
    const csv = toCsv(
      [
        { a: 'plain', b: 'has, comma', c: '=SUM(A1)' },
        { a: 'quote "q"', b: 'line\nbreak', c: null },
      ],
      [
        { header: 'a', value: (r) => r.a },
        { header: 'b', value: (r) => r.b },
        { header: 'c', value: (r) => r.c },
      ],
    );
    expect(csv.split('\r\n')).toEqual(['a,b,c', 'plain,"has, comma",\'=SUM(A1)', '"quote ""q""","line\nbreak",']);
  });
});
