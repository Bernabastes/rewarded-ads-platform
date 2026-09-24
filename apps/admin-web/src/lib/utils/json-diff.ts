export type DiffKind = 'added' | 'removed' | 'changed' | 'unchanged';

export interface DiffEntry {
  /** Dot-path of the key, e.g. "status" or "approvals.0.adminId". */
  path: string;
  kind: DiffKind;
  before: unknown;
  after: unknown;
}

type JsonObject = Record<string, unknown>;

function isPlainObject(v: unknown): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => k in b && deepEqual(a[k], b[k]));
  }
  return false;
}

/**
 * Flat, key-level diff of two JSON documents (audit before/after states).
 * Nested objects are recursed into; arrays and primitives are compared as whole values.
 */
export function diffJson(before: unknown, after: unknown, basePath = ''): DiffEntry[] {
  const b = isPlainObject(before) ? before : {};
  const a = isPlainObject(after) ? after : {};
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)])).sort();
  const out: DiffEntry[] = [];
  for (const key of keys) {
    const path = basePath ? `${basePath}.${key}` : key;
    const inB = key in b;
    const inA = key in a;
    const vb = b[key];
    const va = a[key];
    if (inB && inA && isPlainObject(vb) && isPlainObject(va)) {
      out.push(...diffJson(vb, va, path));
      continue;
    }
    if (!inB) out.push({ path, kind: 'added', before: undefined, after: va });
    else if (!inA) out.push({ path, kind: 'removed', before: vb, after: undefined });
    else if (deepEqual(vb, va)) out.push({ path, kind: 'unchanged', before: vb, after: va });
    else out.push({ path, kind: 'changed', before: vb, after: va });
  }
  return out;
}

export function countChanges(entries: DiffEntry[]): number {
  return entries.filter((e) => e.kind !== 'unchanged').length;
}

export function formatJsonValue(value: unknown): string {
  if (value === undefined) return '—';
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}
