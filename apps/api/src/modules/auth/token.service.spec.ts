import { JwtService } from '@nestjs/jwt';
import { mockPrisma, mockSecurity, testConfig, uuid } from '../../testing/test-utils';
import { deniedJtiKey, TokenService, tokensInvalidBeforeKey } from './token.service';

/** In-memory stand-in for the ioredis commands the denylist uses. */
function fakeRedisClient() {
  const store = new Map<string, { value: string; ttl: number }>();
  return {
    store,
    set: jest.fn(async (key: string, value: string, _ex: string, ttl: number) => {
      store.set(key, { value, ttl });
      return 'OK';
    }),
    mget: jest.fn(async (...keys: string[]) => keys.map((k) => store.get(k)?.value ?? null)),
  };
}

describe('TokenService access-token denylist (F2)', () => {
  const jwt = new JwtService({});
  const config = testConfig({ JWT_ACCESS_TTL_SECONDS: 900 });
  let prisma: ReturnType<typeof mockPrisma>;
  let redis: ReturnType<typeof fakeRedisClient>;
  let service: TokenService;

  beforeEach(() => {
    prisma = mockPrisma();
    prisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });
    redis = fakeRedisClient();
    service = new TokenService(jwt, config, prisma, mockSecurity(), { client: redis } as never);
  });

  it('invalidateAccessTokens stamps tokens_invalid_before with the access TTL and denies older tokens', async () => {
    const userId = uuid(1);
    const issuedAt = Math.floor(Date.now() / 1000) - 60; // issued a minute ago
    await service.invalidateAccessTokens('user', userId, 'user.suspend');

    const stamped = redis.store.get(tokensInvalidBeforeKey('user', userId));
    expect(stamped).toBeDefined();
    expect(stamped!.ttl).toBe(905);
    expect(await service.isAccessTokenDenied('user', userId, { jti: 'a', iat: issuedAt })).toBe(true);
    // a token issued after the stamp is fine again (e.g. reinstated user logs in)
    const later = Math.floor(Date.now() / 1000) + 5;
    expect(await service.isAccessTokenDenied('user', userId, { jti: 'b', iat: later })).toBe(false);
    // other subjects are unaffected
    expect(await service.isAccessTokenDenied('user', uuid(2), { jti: 'c', iat: issuedAt })).toBe(false);
  });

  it('denyAccessToken (logout) denylists only that jti for its remaining lifetime', async () => {
    const userId = uuid(3);
    const tokens = await service.issue({ type: 'user', id: userId });
    const claims = jwt.decode<{ jti: string; iat: number }>(tokens.accessToken);

    await service.denyAccessToken(tokens.accessToken);

    const denied = redis.store.get(deniedJtiKey(claims.jti));
    expect(denied).toBeDefined();
    expect(denied!.ttl).toBeGreaterThan(0);
    expect(denied!.ttl).toBeLessThanOrEqual(900);
    expect(await service.isAccessTokenDenied('user', userId, claims)).toBe(true);
    // a second session of the same user keeps working
    expect(await service.isAccessTokenDenied('user', userId, { jti: 'other', iat: claims.iat })).toBe(false);
  });

  it('refresh-token reuse revokes the family AND invalidates access tokens', async () => {
    const userId = uuid(4);
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt-old',
      tokenHash: 'h',
      subjectType: 'user',
      subjectId: userId,
      familyId: 'fam-1',
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });

    await expect(service.rotate('stolen-token', { ip: '1.1.1.1' })).rejects.toMatchObject({
      code: 'REFRESH_TOKEN_REUSED',
    });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { familyId: 'fam-1', revokedAt: null } }),
    );
    expect(redis.store.has(tokensInvalidBeforeKey('user', userId))).toBe(true);
  });

  it('revokeAllForSubject (suspension / ban / age rejection) revokes refresh tokens and stamps the denylist', async () => {
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    await service.revokeAllForSubject('user', uuid(5), 'age_restricted');
    expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
    expect(redis.store.has(tokensInvalidBeforeKey('user', uuid(5)))).toBe(true);
  });

  it('fails open when Redis is unavailable (tokens are short-lived; account status is re-read from the DB)', async () => {
    redis.mget.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await service.isAccessTokenDenied('user', uuid(6), { jti: 'x', iat: 1 })).toBe(false);
  });

  it('issues impersonation tokens with typ=impersonation, actorAdminId and no refresh token', async () => {
    const result = await service.issueImpersonation(uuid(7), uuid(8));
    const claims = jwt.decode<{ typ: string; actorAdminId: string; sub: string }>(result.accessToken);
    expect(claims.typ).toBe('impersonation');
    expect(claims.actorAdminId).toBe(uuid(8));
    expect(claims.sub).toBe(uuid(7));
    expect(result.expiresIn).toBe(600);
    expect(result).not.toHaveProperty('refreshToken');
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });
});
