import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';

/** bcrypt cost for every stored password (admins, advertisers, seed) - docs/SECURITY.md says 12, so it is 12. */
export const BCRYPT_ROUNDS = 12;

/**
 * Phase 5b New-7 (timing oracle): a login for an unknown e-mail still runs a full bcrypt compare against this
 * throw-away hash, so "account exists" and "wrong password" take the same time. Computed once per process.
 */
let dummyHash: string | undefined;
export async function dummyPasswordHash(): Promise<string> {
  dummyHash ??= await bcrypt.hash(`timing-equaliser:${randomUUID()}`, BCRYPT_ROUNDS);
  return dummyHash;
}

/** Constant-work password check: an unknown account costs the same as a wrong password (New-7). */
export async function passwordMatches(password: string, passwordHash: string | undefined | null): Promise<boolean> {
  const matched = await bcrypt.compare(password ?? '', passwordHash ?? (await dummyPasswordHash()));
  return matched && Boolean(passwordHash);
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}
