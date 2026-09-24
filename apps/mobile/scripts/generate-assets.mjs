#!/usr/bin/env node
// Generates the app icon / splash / favicon PNGs from the flat two-tone "Gize" coin mark
// (forest + terracotta, deliberately non-metallic). Re-run with `node scripts/generate-assets.mjs`.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
mkdirSync(outDir, { recursive: true });

const FOREST_600 = [0x1f, 0x6a, 0x4c];
const FOREST_100 = [0xd7, 0xea, 0xe0];
const TERRACOTTA_400 = [0xe6, 0x7b, 0x41];
const STONE_50 = [0xfa, 0xf8, 0xf5];

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePng(width, height, pixels) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Anti-aliased coin mark: outer disc (light), inner disc (terracotta), a forest "time" notch at 12 o'clock. */
function render(size, { background, markScale }) {
  const px = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = (size / 2) * markScale;
  const rInner = rOuter * 0.62;
  const notchW = rOuter * 0.14;
  const notchTop = cy - rOuter * 0.9;
  const notchBottom = cy - rInner * 0.55;

  const aa = (d) => Math.min(1, Math.max(0, 0.5 - d)); // coverage from signed distance (px)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.hypot(dx, dy);
      let color = background ? [...background, 255] : [0, 0, 0, 0];
      const outerCov = aa(dist - rOuter);
      if (outerCov > 0) color = blend(color, [...FOREST_100, 255], outerCov);
      const innerCov = aa(dist - rInner);
      if (innerCov > 0) color = blend(color, [...TERRACOTTA_400, 255], innerCov);
      // Notch: a rounded bar from the rim towards the centre - the "hand" of a clock (Gize = time).
      const inNotchX = Math.abs(dx) - notchW / 2;
      const inNotchY = Math.max(notchTop - (y + 0.5), y + 0.5 - notchBottom);
      const notchCov = aa(Math.max(inNotchX, inNotchY));
      if (notchCov > 0 && dist < rOuter) color = blend(color, [...FOREST_600, 255], notchCov);
      px.set(color, (y * size + x) * 4);
    }
  }
  return encodePng(size, size, px);
}
function blend(base, top, a) {
  const outA = top[3] * a + base[3] * (1 - a);
  if (outA === 0) return [0, 0, 0, 0];
  const mix = (i) => Math.round((top[i] * top[3] * a + base[i] * base[3] * (1 - a)) / outA);
  return [mix(0), mix(1), mix(2), Math.round(outA)];
}

writeFileSync(path.join(outDir, 'icon.png'), render(1024, { background: FOREST_600, markScale: 0.62 }));
writeFileSync(path.join(outDir, 'adaptive-icon.png'), render(1024, { background: null, markScale: 0.5 }));
writeFileSync(path.join(outDir, 'splash-icon.png'), render(512, { background: null, markScale: 0.9 }));
writeFileSync(path.join(outDir, 'favicon.png'), render(64, { background: STONE_50, markScale: 0.9 }));
console.log('[assets] generated icon.png, adaptive-icon.png, splash-icon.png, favicon.png');
