import { mockAudit, mockPrisma, mockSecurity, testConfig, uuid } from '../../testing/test-utils';
import {
  ALERT_TYPES,
  evaluateAccountMinting,
  evaluateOtpSpike,
  evaluatePayoutFailureRate,
  evaluateSpendVelocity,
  ledgerDriftAlert,
} from './alert.rules';
import { AlertService } from './alerts.service';
import { formatAlertText, type Notifier } from './notifiers';

describe('alert rules (pure)', () => {
  describe('payout failure rate', () => {
    const cfg = { threshold: 0.2, minSample: 5 };
    it('ignores small samples', () => {
      expect(evaluatePayoutFailureRate({ completed: 1, failed: 3 }, cfg)).toBeNull();
    });
    it('is silent at or below the threshold', () => {
      expect(evaluatePayoutFailureRate({ completed: 8, failed: 2 }, cfg)).toBeNull();
    });
    it('raises a warning above the threshold and critical at twice the threshold', () => {
      expect(evaluatePayoutFailureRate({ completed: 7, failed: 3 }, cfg)).toMatchObject({
        type: ALERT_TYPES.payoutFailureRate,
        severity: 'warning',
        payload: { rate: 0.3 },
      });
      expect(evaluatePayoutFailureRate({ completed: 5, failed: 5 }, cfg)?.severity).toBe('critical');
    });
  });

  describe('account minting', () => {
    it('flags fingerprints creating more accounts than allowed per hour, deduped per fingerprint', () => {
      const alerts = evaluateAccountMinting(
        [
          { fingerprint: 'fp-a', accounts: 3 },
          { fingerprint: 'fp-b', accounts: 4 },
          { fingerprint: 'fp-c', accounts: 9 },
        ],
        { accountsPerDevicePerHour: 3 },
      );
      expect(alerts.map((a) => [a.payload.deviceFingerprint, a.severity])).toEqual([
        ['fp-b', 'warning'],
        ['fp-c', 'critical'],
      ]);
      expect(alerts[0].dedupeKey).toBe('account_minting:fp-b');
    });
  });

  describe('spend velocity', () => {
    const cfg = { multiplier: 5, minEtb: 50 };
    const row = { campaignId: uuid(1), title: 'Buna', advertiserName: 'Buna Time' };
    it('ignores campaigns below the minimum hourly spend', () => {
      expect(evaluateSpendVelocity([{ ...row, lastHourEtb: 49, trailing7dEtb: 0 }], cfg)).toEqual([]);
    });
    it('compares against multiplier x trailing hourly average', () => {
      // avg = 1670/167 = 10 ETB/h -> limit 50; 60 in the last hour is a spike
      expect(evaluateSpendVelocity([{ ...row, lastHourEtb: 60, trailing7dEtb: 1670 }], cfg)).toHaveLength(1);
      // avg = 3340/167 = 20 ETB/h -> limit 100; 60 is normal
      expect(evaluateSpendVelocity([{ ...row, lastHourEtb: 60, trailing7dEtb: 3340 }], cfg)).toEqual([]);
    });
    it('a brand-new campaign burning more than the minimum in an hour alerts (avg 0)', () => {
      const [alert] = evaluateSpendVelocity([{ ...row, lastHourEtb: 80, trailing7dEtb: 0 }], cfg);
      expect(alert).toMatchObject({ type: ALERT_TYPES.spendVelocity, severity: 'warning', dedupeKey: `spend_velocity:${uuid(1)}` });
    });
  });

  describe('OTP spike', () => {
    it('flags IPs above the per-hour threshold', () => {
      const alerts = evaluateOtpSpike([{ ip: '1.1.1.1', requests: 21 }, { ip: '2.2.2.2', requests: 5 }], { requestsPerIpPerHour: 20 });
      expect(alerts).toHaveLength(1);
      expect(alerts[0].payload.ip).toBe('1.1.1.1');
    });
  });

  it('ledger drift is always critical and deduped per user', () => {
    const a = ledgerDriftAlert({ userId: uuid(3), cachedBalance: 100, ledgerSum: 90, runId: uuid(4) });
    expect(a).toMatchObject({ severity: 'critical', dedupeKey: `ledger_drift:${uuid(3)}`, payload: { difference: 10 } });
  });

  it('formatAlertText renders severity, title, scalar payload fields and the admin link', () => {
    const text = formatAlertText(
      { id: uuid(5), type: 'X', severity: 'warning', title: 'Hello', payload: { a: 1, nested: { b: 2 } }, createdAt: new Date() },
      'http://admin',
    );
    expect(text).toContain('[WARNING] Hello');
    expect(text).toContain('a: 1');
    expect(text).not.toContain('nested');
    expect(text).toContain(`http://admin/alerts/${uuid(5)}`);
  });
});

describe('AlertService.raise', () => {
  let prisma: any;
  let notifier: jest.Mocked<Notifier>;
  let service: AlertService;
  const config = testConfig({ ALERT_DEDUPE_MINUTES: 60 });

  beforeEach(() => {
    prisma = mockPrisma();
    notifier = { name: 'telegram', isMock: false, send: jest.fn().mockResolvedValue({ notifier: 'telegram', ok: true }) };
    service = new AlertService(prisma, config, mockSecurity(), mockAudit(), [notifier]);
    prisma.platformAlert.create.mockImplementation(async ({ data }: any) => ({ id: uuid(9), createdAt: new Date(), ...data }));
    prisma.platformAlert.update.mockImplementation(async ({ data }: any) => ({ id: uuid(9), ...data }));
  });

  const alert = { type: 'X', severity: 'warning' as const, title: 't', payload: { k: 1 }, dedupeKey: 'x:1' };

  it('persists, delivers to every notifier and stores the delivery results', async () => {
    prisma.platformAlert.findFirst.mockResolvedValue(null);
    const row = await service.raise(alert);
    expect(prisma.platformAlert.create).toHaveBeenCalledTimes(1);
    expect(notifier.send).toHaveBeenCalledTimes(1);
    expect(row?.deliveries).toEqual([{ notifier: 'telegram', ok: true }]);
  });

  it('suppresses a duplicate within the dedupe window', async () => {
    prisma.platformAlert.findFirst.mockResolvedValue({ id: 'recent' });
    expect(await service.raise(alert)).toBeNull();
    expect(prisma.platformAlert.create).not.toHaveBeenCalled();
    expect(notifier.send).not.toHaveBeenCalled();
  });

  it('records delivery failures without throwing', async () => {
    prisma.platformAlert.findFirst.mockResolvedValue(null);
    notifier.send.mockRejectedValueOnce(new Error('telegram down'));
    const row = await service.raise(alert);
    expect(row?.deliveries).toEqual([{ notifier: 'telegram', ok: false, error: 'telegram down' }]);
  });
});
