#!/usr/bin/env node
// Cross-platform `pnpm -r run <script>` equivalent that does not re-invoke the pnpm binary.
// Some Windows setups cannot resolve the `pnpm` shim from inside package scripts (cmd.exe picks the
// extension-less shell shim first); this keeps `pnpm typecheck|lint|test|build` working everywhere.
//
//   node scripts/run-workspace.mjs <script> [--filter <pkgName>]
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [script, ...rest] = process.argv.slice(2);
if (!script) {
  console.error('usage: node scripts/run-workspace.mjs <script> [--filter <packageName>]');
  process.exit(2);
}
const filterIdx = rest.indexOf('--filter');
const filter = filterIdx >= 0 ? rest[filterIdx + 1] : null;

// packages/* first (shared contract), then apps/* – matches the workspace dependency order.
const dirs = ['packages', 'apps']
  .flatMap((group) => {
    const groupDir = path.join(root, group);
    if (!existsSync(groupDir)) return [];
    return readdirSync(groupDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(path.join(groupDir, d.name, 'package.json')))
      .map((d) => path.join(groupDir, d.name));
  });

const isWin = process.platform === 'win32';
let failed = false;

for (const dir of dirs) {
  const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  if (filter && pkg.name !== filter) continue;
  const scripts = pkg.scripts ?? {};
  if (!scripts[script]) continue;

  for (const name of [`pre${script}`, script, `post${script}`]) {
    const command = scripts[name];
    if (!command) continue;
    console.log(`\n> ${pkg.name} ${name}$ ${command}`);
    const env = {
      ...process.env,
      PATH: [path.join(dir, 'node_modules', '.bin'), path.join(root, 'node_modules', '.bin'), process.env.PATH ?? ''].join(path.delimiter),
      npm_package_name: pkg.name,
      npm_lifecycle_event: name,
    };
    const result = spawnSync(command, { cwd: dir, stdio: 'inherit', shell: isWin ? process.env.ComSpec || 'cmd.exe' : true, env });
    if (result.status !== 0) {
      console.error(`\n${pkg.name} ${name} failed with exit code ${result.status ?? 'null'}`);
      failed = true;
      break;
    }
  }
  if (failed) break;
}

process.exit(failed ? 1 : 0);
