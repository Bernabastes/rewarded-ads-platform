import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Loads `apps/api/.env` or the repository-root `.env` into process.env (shell variables win) so that
 * `pnpm dev:api`, the seed and the OpenAPI export all work from a single root .env on every OS.
 * Inline comments ("KEY=value  # note") are stripped because Node's loader keeps them verbatim.
 */
export function loadDotenv(): string | null {
  const candidates = [path.resolve(process.cwd(), '.env'), path.resolve(__dirname, '..', '.env'), path.resolve(__dirname, '..', '..', '..', '.env')];
  const file = candidates.find((p) => existsSync(p));
  if (!file) return null;
  const before = new Set(Object.keys(process.env));
  try {
    process.loadEnvFile(file);
  } catch {
    return null;
  }
  for (const key of Object.keys(process.env)) {
    if (before.has(key)) continue;
    const v = process.env[key];
    if (typeof v === 'string' && /\s#/.test(v)) process.env[key] = v.replace(/\s+#.*$/, '').trim();
  }
  return file;
}
