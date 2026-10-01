import { ErrorCode } from '@rap/shared';
import { sha256 } from '../../common/utils';
import { mockPrisma, mockRedis, mockSecurity, testConfig } from '../../testing/test-utils';
import { constantTimeEqualHex, OtpVerifier } from './otp.verifier';

const PHONE = '+251911000000';
const CODE = '123456';

/**
 * In-memory otp_codes table with the atomic semantics of the real `updateMany` conditions: JS runs the mock
 * callbacks one at a time, exactly like Postgres serialises row updates, so N concurrent verify() calls see the
 * same claim/consume behaviour as in production.
 */
function otpTable(prisma: any, row: { id: string; codeHash: string; attempts: number; expiresAt: Date; consumedAt: Date | null }) {
  const rows = [row];
  prisma.otpCode.findFirst.mockImplementation(async () => {
    const r = rows.find((x) => x.consumedAt === null);
    return r ? { ...r } : null;
  });
  prisma.otpCode.updateMany.mockImplementation(async ({ where, data }: any) => {
    let count = 0;
    for (const r of rows) {
      if (where.id && r.id !== where.id) continue;
      if ('consumedAt' in where && where.consumedAt === null && r.consumedAt !== null) continue;
      if (where.attempts?.lt !== undefined && !(r.attempts < where.attempts.lt)) continue;
      if (where.attempts?.gte !== undefined && !(r.attempts >= where.attempts.gte)) continue;
      if (data.attempts?.increment) r.attempts += data.attempts.increment;
      if (data.consumedAt !== undefined) r.consumedAt = data.consumedAt;
      count += 1;
    }
    return { count };
  });
  return rows;
}

describe('OtpVerifier (security audit #4: brute-force resistance)', () => {
  let prisma: any;
  let redis: ReturnType<typeof mockRedis>;
  let verifier: OtpVerifier;
  const config = testConfig({ OTP_MAX_ATTEMPTS: 5, OTP_VERIFY_LIMIT_PER_PHONE: 1000, OTP_VERIFY_LIMIT_PER_IP: 1000 });
  const freshRow = () => ({ id: 'otp-1', codeHash: sha256(`${PHONE}:${CODE}`), attempts: 0, expiresAt: new Date(Date.now() + 60_000), consumedAt: null });
  const attempt = (code: string, ip = '1.1.1.1') =>
    verifier.verify({ phone: PHONE, purpose: 'login', code, hashInput: (c) => `${PHONE}:${c}`, ip });

  beforeEach(() => {
    prisma = mockPrisma();
    redis = mockRedis();
    verifier = new OtpVerifier(prisma, redis, config, mockSecurity());
  });

  it('REGRESSION: 20 parallel wrong guesses evaluate at most OTP_MAX_ATTEMPTS codes and burn the code', async () => {
    const rows = otpTable(prisma, freshRow());
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => attempt(String(i).padStart(6, '0'))));
    const codes = results.map((r) => (r.status === 'rejected' ? (r.reason as { code: string }).code : 'ok'));
    expect(codes.filter((c) => c === 'ok')).toHaveLength(0);
    // exactly 5 attempts were CLAIMED (and therefore compared); the other 15 never reached the comparison
    expect(codes.filter((c) => c === ErrorCode.OTP_INVALID)).toHaveLength(5);
    expect(codes.filter((c) => c === ErrorCode.OTP_TOO_MANY_ATTEMPTS)).toHaveLength(15);
    expect(rows[0].attempts).toBe(5);
    expect(rows[0].consumedAt).not.toBeNull(); // burned
    // even the correct code is now useless: a new one must be requested
    await expect(attempt(CODE)).rejects.toMatchObject({ code: ErrorCode.OTP_INVALID, status: 400 });
  });

  it('the correct code is consumed exactly once even when submitted concurrently', async () => {
    otpTable(prisma, freshRow());
    const results = await Promise.allSettled([attempt(CODE), attempt(CODE), attempt(CODE)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(2);
  });

  it('counts down attemptsRemaining and burns on the last wrong attempt', async () => {
    const rows = otpTable(prisma, freshRow());
    for (let i = 4; i >= 1; i--) {
      await expect(attempt('000000')).rejects.toMatchObject({ code: ErrorCode.OTP_INVALID, details: { attemptsRemaining: i } });
      expect(rows[0].consumedAt).toBeNull();
    }
    await expect(attempt('000000')).rejects.toMatchObject({ code: ErrorCode.OTP_INVALID, details: { attemptsRemaining: 0 } });
    expect(rows[0].consumedAt).not.toBeNull();
  });

  it('expired codes answer OTP_EXPIRED without claiming an attempt', async () => {
    const rows = otpTable(prisma, { ...freshRow(), expiresAt: new Date(Date.now() - 1) });
    await expect(attempt(CODE)).rejects.toMatchObject({ code: ErrorCode.OTP_EXPIRED, status: 400 });
    expect(rows[0].attempts).toBe(0);
  });

  it('throttles verify attempts per phone and per IP in Redis (429 OTP_TOO_MANY_ATTEMPTS)', async () => {
    const strict = new OtpVerifier(prisma, redis, testConfig({ OTP_VERIFY_LIMIT_PER_PHONE: 3, OTP_VERIFY_LIMIT_PER_IP: 100, OTP_VERIFY_WINDOW_SECONDS: 900 }), mockSecurity());
    otpTable(prisma, freshRow());
    const run = (ip: string) => strict.verify({ phone: PHONE, purpose: 'login', code: '000000', hashInput: (c) => `${PHONE}:${c}`, ip });
    for (let i = 0; i < 3; i++) await expect(run(`9.9.9.${i}`)).rejects.toMatchObject({ code: ErrorCode.OTP_INVALID });
    // 4th attempt from yet another IP: blocked by the per-PHONE limit before any DB access
    prisma.otpCode.findFirst.mockClear();
    await expect(run('9.9.9.9')).rejects.toMatchObject({ code: ErrorCode.OTP_TOO_MANY_ATTEMPTS, status: 429, details: { retryAfterSeconds: 900 } });
    expect(prisma.otpCode.findFirst).not.toHaveBeenCalled();
    // per-IP limit is independent and keyed by purpose
    const ipStrict = new OtpVerifier(prisma, mockRedis(), testConfig({ OTP_VERIFY_LIMIT_PER_PHONE: 100, OTP_VERIFY_LIMIT_PER_IP: 2 }), mockSecurity());
    otpTable(prisma, freshRow());
    const other = (phone: string) => ipStrict.verify({ phone, purpose: 'destination_change', code: '000000', hashInput: (c) => `${phone}:destination_change:${c}`, ip: '5.5.5.5' });
    await expect(other('+251911000001')).rejects.toMatchObject({ code: ErrorCode.OTP_INVALID });
    await expect(other('+251911000002')).rejects.toMatchObject({ code: ErrorCode.OTP_INVALID });
    await expect(other('+251911000003')).rejects.toMatchObject({ code: ErrorCode.OTP_TOO_MANY_ATTEMPTS });
  });

  it('compares digests in constant time and treats length mismatches as unequal', () => {
    const a = sha256('a');
    expect(constantTimeEqualHex(a, sha256('a'))).toBe(true);
    expect(constantTimeEqualHex(a, sha256('b'))).toBe(false);
    expect(constantTimeEqualHex(a, a.slice(0, 10))).toBe(false);
    expect(constantTimeEqualHex('', '')).toBe(false);
  });
});
