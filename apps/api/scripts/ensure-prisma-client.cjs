#!/usr/bin/env node
// Generates the Prisma client only when it is missing or older than schema.prisma.
// Avoids needless regeneration (and Windows file locks on the query engine while the API is running).
const { spawnSync } = require('node:child_process');
const { existsSync, statSync } = require('node:fs');
const path = require('node:path');

const apiDir = path.resolve(__dirname, '..');
const schema = path.join(apiDir, 'prisma', 'schema.prisma');
const candidates = [
  path.join(apiDir, 'node_modules', '.prisma', 'client', 'index.js'),
  path.resolve(apiDir, '..', '..', 'node_modules', '.prisma', 'client', 'index.js'),
];
const generated = candidates.find((p) => existsSync(p));
const force = process.argv.includes('--force');

if (!force && generated && statSync(generated).mtimeMs >= statSync(schema).mtimeMs) {
  console.log('[prisma] client is up to date');
  process.exit(0);
}

const binDirs = [
  path.join(apiDir, 'node_modules', '.bin'),
  path.resolve(apiDir, '..', '..', 'node_modules', '.bin'),
];
process.env.PATH = [...binDirs, process.env.PATH ?? ''].join(path.delimiter);
process.env.DATABASE_URL ??= 'postgresql://rap:rap@localhost:5432/rap?schema=public';
const result = spawnSync('prisma', ['generate'], {
  cwd: apiDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
});
process.exit(result.status ?? 1);
