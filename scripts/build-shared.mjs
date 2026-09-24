// Root postinstall: build @rap/shared so every workspace package can resolve its dist output
// right after `pnpm install`. Invokes tsup through Node directly (no reliance on `pnpm` being on PATH
// inside lifecycle scripts, which is not guaranteed on Windows).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sharedDir = path.join(root, 'packages', 'shared');
const candidates = [
  path.join(root, 'node_modules', 'tsup', 'dist', 'cli-default.js'),
  path.join(sharedDir, 'node_modules', 'tsup', 'dist', 'cli-default.js'),
];
const tsupCli = candidates.find((p) => existsSync(p));

if (!tsupCli) {
  console.warn('[build-shared] tsup not installed yet; skipping @rap/shared build');
  process.exit(0);
}

console.log('[build-shared] building @rap/shared ...');
const result = spawnSync(process.execPath, [tsupCli], { cwd: sharedDir, stdio: 'inherit' });
process.exit(result.status ?? 1);
