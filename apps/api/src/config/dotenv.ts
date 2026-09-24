import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Loads `apps/api/.env` or the repository-root `.env` into process.env (shell variables win) so that
 * `pnpm dev:api`, the seed, tests and the OpenAPI export all work from a single root .env on every OS.
 * Self-contained parser (no dependency on process.loadEnvFile, which Jest's sandboxed `process` lacks):
 * supports `KEY=value`, quoted values, `# comments` and inline comments after whitespace.
 */
export function loadDotenv(): string | null {
  // __dirname is apps/api/src/config (ts) or apps/api/dist/config (js): two levels up is apps/api, four is the repo root.
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '..', '..', '.env'),
    path.resolve(__dirname, '..', '..', '..', '..', '.env'),
  ];
  const file = candidates.find((p) => existsSync(p));
  if (!file) return null;
  for (const [key, value] of Object.entries(parseDotenv(readFileSync(file, 'utf8')))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return file;
}

export function parseDotenv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line
      .slice(0, eq)
      .trim()
      .replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) out[key] = value;
  }
  return out;
}
