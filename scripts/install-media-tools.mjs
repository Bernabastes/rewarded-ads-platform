#!/usr/bin/env node
/**
 * Installs desktop ffmpeg/ffprobe binaries for the media.process pipeline on developer machines:
 *
 *   pnpm media:tools
 *
 * They go into ./tools/media (gitignored) via the `ffmpeg-static` / `ffprobe-static` npm packages, OUTSIDE the
 * workspace lockfile: the packages weigh ~150 MB of multi-platform binaries and repeatedly timed out inside Docker
 * image builds. The API resolves binaries in this order: MEDIA_FFMPEG_PATH/MEDIA_FFPROBE_PATH -> tools/media ->
 * a dependency named ffmpeg-static/ffprobe-static -> plain `ffmpeg`/`ffprobe` on PATH. The Docker image sets the
 * env vars to the `apk add ffmpeg` binaries, so this script is never needed in containers.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'tools', 'media');
mkdirSync(dir, { recursive: true });
if (!existsSync(path.join(dir, 'package.json'))) {
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'rap-media-tools', private: true }, null, 2));
}

console.log(`[media:tools] installing ffmpeg-static + ffprobe-static into ${dir}`);
execSync('npm install --no-audit --no-fund --loglevel=error ffmpeg-static@5 ffprobe-static@3', {
  cwd: dir,
  stdio: 'inherit',
  env: { ...process.env, npm_config_ignore_scripts: 'false' },
});

const require = createRequire(path.join(dir, 'package.json'));
const ffmpeg = require('ffmpeg-static');
const ffprobe = require('ffprobe-static').path;
for (const [name, bin] of [
  ['ffmpeg', ffmpeg],
  ['ffprobe', ffprobe],
]) {
  if (!bin || !existsSync(bin)) {
    console.error(`[media:tools] ${name} binary missing (${bin}). Install ffmpeg on your PATH instead.`);
    process.exitCode = 1;
  } else {
    console.log(`[media:tools] ${name}: ${bin}`);
  }
}
