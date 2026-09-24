import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Grep-able architectural guarantee (spec §8): no code path other than the ledger core writes users.coin_balance.
 * Any new `coinBalance:` write or raw `UPDATE users ... coin_balance` outside ledger.core.ts fails this test.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts') && !full.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

const ROOT = path.resolve(__dirname, '..', '..');
const ALLOWED = [path.join('modules', 'ledger', 'ledger.core.ts')];

describe('coin_balance write guard', () => {
  const files = walk(ROOT);

  it('scans the API source tree', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('only ledger.core.ts assigns coinBalance in a Prisma write', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(ROOT, file);
      if (ALLOWED.some((a) => rel.endsWith(a))) continue;
      const src = readFileSync(file, 'utf8');
      // `coinBalance: true` (select) and `coinBalance: number` (types) are fine; `coinBalance: <expr>` inside data is not.
      const writes =
        src.match(
          /coinBalance:\s*(?!true\b|number\b|user\.coinBalance|u\.coinBalance|existing\.coinBalance)[A-Za-z_$][\w.]*/g,
        ) ?? [];
      const dataWrites = writes.filter((w) => {
        const idx = src.indexOf(w);
        const before = src.slice(Math.max(0, idx - 400), idx);
        return (
          /data:\s*\{[^}]*$/.test(before) ||
          /\.update\(|\.updateMany\(|\.create\(|\.upsert\(/.test(before.slice(-200))
        );
      });
      if (dataWrites.length) offenders.push(`${rel}: ${dataWrites.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('no raw SQL touches users.coin_balance outside ledger.core.ts', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(ROOT, file);
      if (ALLOWED.some((a) => rel.endsWith(a))) continue;
      const src = readFileSync(file, 'utf8');
      if (/UPDATE\s+"?users"?\s+SET[^;`]*coin_balance/i.test(src)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it('ledger.core.ts contains exactly one coin_balance write', () => {
    const src = readFileSync(path.join(ROOT, 'modules', 'ledger', 'ledger.core.ts'), 'utf8');
    expect(src.match(/data:\s*\{\s*coinBalance:/g)).toHaveLength(1);
  });
});
