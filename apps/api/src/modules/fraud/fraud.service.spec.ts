import { mockAudit, mockPrisma, mockRedis, mockSecurity, testConfig, uuid } from '../../testing/test-utils';
import { FraudService } from './fraud.service';

/**
 * Phase 5c (New-5 informational): the Redis IP-velocity counter honours SECURITY_REDIS_FAIL_MODE. Closed => the
 * velocity is treated as exceeded (the completion gets flagged for review, never auto-rejected on this signal alone);
 * open => the DB count alone is used. Both paths emit a security event.
 */
describe('FraudService IP velocity when Redis is unavailable (Phase 5c)', () => {
  const input = {
    user: { id: uuid(1), trustScore: 60, createdAt: new Date('2026-01-01') },
    adDurationSeconds: 30,
    watchDurationSeconds: 31,
    heartbeatCount: 6,
    expectedHeartbeats: 6,
    deviceFingerprint: 'fp-1',
    ipAddress: '10.0.0.9',
    todayCompletions: 1,
  };

  const build = (mode: 'open' | 'closed') => {
    const prisma = mockPrisma();
    prisma.adWatchSession.findMany.mockResolvedValue([]);
    prisma.adCompletion.count.mockResolvedValue(0);
    const redis = mockRedis();
    redis.getNumber.mockRejectedValue(new Error('ECONNREFUSED'));
    const security = mockSecurity();
    const config = testConfig({ SECURITY_REDIS_FAIL_MODE: mode });
    return { service: new FraudService(prisma, redis, config, security, mockAudit()), security, config };
  };

  it('open: falls back to the database count (0) and logs the outage', async () => {
    const { service, security } = build('open');
    const signals = await service.collectCompletionSignals(input);
    expect(signals.ipCompletionsLastHour).toBe(0);
    expect(service.evaluate(signals).hits.map((h) => h.ruleId)).not.toContain('IP_VELOCITY');
    expect(security.error).toHaveBeenCalledWith('auth.denylist_unavailable', expect.objectContaining({ scope: 'fraud_ip_velocity', failMode: 'open' }));
  });

  it('closed: treats the IP velocity as exceeded -> IP_VELOCITY hit (a flag-weight signal, never a rejection) and logs it', async () => {
    const { service, security, config } = build('closed');
    const signals = await service.collectCompletionSignals(input);
    expect(signals.ipCompletionsLastHour).toBe(config.fraud.ipCompletionsPerHourThreshold);
    const evaluation = service.evaluate(signals);
    expect(evaluation.hits.map((h) => h.ruleId)).toContain('IP_VELOCITY');
    // IP_VELOCITY weighs 25 (flag threshold 40 in tests is not reached by itself): the signal alone never rejects
    expect(evaluation.outcome).not.toBe('rejected');
    expect(security.error).toHaveBeenCalledWith('auth.denylist_unavailable', expect.objectContaining({ scope: 'fraud_ip_velocity', failMode: 'closed' }));
  });
});
