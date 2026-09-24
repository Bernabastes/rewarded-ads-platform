#!/usr/bin/env node
// Runs Jest with the Node flags required to `require()` the ESM-only NestJS 12 packages from
// CommonJS test files (Jest >= 30 + Node >= 24.9 support require(esm) behind --experimental-vm-modules).
const { spawnSync } = require('node:child_process');

const jestBin = require.resolve('jest/bin/jest');
const result = spawnSync(
  process.execPath,
  ['--experimental-vm-modules', '--no-warnings=ExperimentalWarning', jestBin, ...process.argv.slice(2)],
  { stdio: 'inherit', env: process.env },
);
process.exit(result.status ?? 1);
