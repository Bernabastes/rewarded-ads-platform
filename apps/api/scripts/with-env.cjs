#!/usr/bin/env node
// Loads environment variables from apps/api/.env or the repo-root .env (first one found, without overriding
// variables already set in the shell) and then runs the given command. Used by the Prisma/seed npm scripts so
// a single root `.env` configures everything on every OS.
const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');

const candidates = [path.resolve(__dirname, '..', '.env'), path.resolve(__dirname, '..', '..', '..', '.env')];
const envFile = candidates.find((p) => existsSync(p));
if (envFile) {
  const before = new Set(Object.keys(process.env));
  try {
    process.loadEnvFile(envFile);
    // strip inline comments ("KEY=value   # comment") that loadEnvFile keeps verbatim
    for (const key of Object.keys(process.env)) {
      if (before.has(key)) continue;
      const v = process.env[key];
      if (typeof v === 'string' && /\s#/.test(v)) process.env[key] = v.replace(/\s+#.*$/, '').trim();
    }
  } catch (err) {
    console.warn(`[with-env] could not load ${envFile}: ${err.message}`);
  }
}

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error('usage: node scripts/with-env.cjs <command> [args...]');
  process.exit(2);
}
// Make workspace binaries resolvable even when not invoked through `pnpm run`.
const binDirs = [path.resolve(__dirname, '..', 'node_modules', '.bin'), path.resolve(__dirname, '..', '..', '..', 'node_modules', '.bin')];
process.env.PATH = [...binDirs, process.env.PATH ?? ''].join(path.delimiter);
const result = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', env: process.env });
process.exit(result.status ?? 1);
