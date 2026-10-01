import { ErrorCode } from '@rap/shared';
import { createHmac } from 'node:crypto';
import { D, mockAudit, mockPrisma, mockSecurity, testConfig, uuid } from '../../testing/test-utils';
import { BillingService } from './billing.service';
import { ChapaGateway } from './gateway/chapa.gateway';

const SECRET = 'whsec_unit_test_secret_0123456789';
const TX = 'RAP-TEST-1';
const PAYMENT_ID = uuid(50);
const ADVERTISER = uuid(51);

const sign = (raw: string) => ({ 'chapa-signature': createHmac('sha256', SECRET).update(raw).digest('hex') });
const legacyConstant = () => ({ 'x-chapa-signature': createHmac('sha256', SECRET).update(SECRET).digest('hex') });

describe('Chapa webhook hardening (security audit #17)', () => {
  const config = testConfig({ CHAPA_WEBHOOK_SECRET: SECRET, CHAPA_SECRET_KEY: 'CHASECK_TEST-real-mode-key' });

  describe('ChapaGateway.verifyWebhookSignature', () => {
    const gateway = new ChapaGateway(config);
    const raw = JSON.stringify({ tx_ref: TX, status: 'success' });

    it('accepts the payload-bound Chapa-Signature (any header casing)', () => {
      expect(gateway.verifyWebhookSignature(raw, sign(raw))).toBe(true);
      expect(gateway.verifyWebhookSignature(Buffer.from(raw), { 'Chapa-Signature': sign(raw)['chapa-signature'] })).toBe(true);
    });

    it('REJECTS the constant x-chapa-signature on its own (replayable with any body) and tampered bodies', () => {
      expect(gateway.verifyWebhookSignature(raw, legacyConstant())).toBe(false);
      const tampered = raw.replace('success', 'failed');
      expect(gateway.verifyWebhookSignature(tampered, sign(raw))).toBe(false);
      expect(gateway.verifyWebhookSignature(raw, {})).toBe(false);
      expect(gateway.verifyWebhookSignature(raw, { 'chapa-signature': 'deadbeef' })).toBe(false);
    });

    it('cannot validate anything without a configured secret', () => {
      expect(new ChapaGateway(testConfig({ CHAPA_WEBHOOK_SECRET: undefined })).verifyWebhookSignature(raw, sign(raw))).toBe(false);
    });
  });

  describe('BillingService.handleChapaWebhook (real gateway mode)', () => {
    let prisma: any;
    let gateway: any;
    let wallet: any;
    let security: any;
    let service: BillingService;
    const payment = { id: PAYMENT_ID, advertiserId: ADVERTISER, txRef: TX, gateway: 'chapa', amountEtb: D(300), currency: 'ETB', status: 'pending', mock: false, gatewayReference: null };

    beforeEach(() => {
      prisma = mockPrisma();
      wallet = { applyEntry: jest.fn().mockResolvedValue({ replayed: false }) };
      security = mockSecurity();
      gateway = {
        name: 'chapa',
        isMock: false,
        verify: jest.fn(),
        verifyWebhookSignature: new ChapaGateway(config).verifyWebhookSignature.bind(new ChapaGateway(config)),
      };
      prisma.advertiserPayment.findUnique.mockResolvedValue(payment);
      prisma.advertiserPayment.findUniqueOrThrow.mockResolvedValue(payment);
      prisma.$queryRaw.mockResolvedValue([{ id: PAYMENT_ID }]);
      prisma.advertiserPayment.update.mockImplementation(async ({ data }: any) => ({ ...payment, ...data }));
      prisma.advertiserPayment.updateMany.mockResolvedValue({ count: 1 });
      service = new BillingService(prisma, config, wallet, mockAudit(), security, gateway);
    });

    const post = (body: Record<string, unknown>, headers?: Record<string, string>, raw = JSON.stringify(body)) =>
      service.handleChapaWebhook(Buffer.from(raw), body, headers ?? sign(raw), '41.0.0.1');

    it('rejects a body signed only with the constant header, and a body whose raw bytes are missing', async () => {
      const body = { tx_ref: TX, status: 'success' };
      await expect(post(body, legacyConstant())).rejects.toMatchObject({ code: ErrorCode.WEBHOOK_SIGNATURE_INVALID, status: 401 });
      await expect(service.handleChapaWebhook(undefined, body, sign(JSON.stringify(body)), '41.0.0.1')).rejects.toMatchObject({ code: ErrorCode.WEBHOOK_SIGNATURE_INVALID });
      expect(wallet.applyEntry).not.toHaveBeenCalled();
    });

    it('settles only when verify() confirms success with the SAME amount and currency', async () => {
      gateway.verify.mockResolvedValue({ status: 'success', amountEtb: 300, currency: 'ETB', gatewayReference: 'CH-1' });
      const res = await post({ tx_ref: TX, status: 'success', amount: '300' });
      expect(res).toMatchObject({ received: true, status: 'completed' });
      expect(wallet.applyEntry).toHaveBeenCalledWith(expect.objectContaining({ amountEtb: D(300), idempotencyKey: `topup:${PAYMENT_ID}` }), prisma);
    });

    it('refuses to settle when the verified amount or currency differs (400 PAYMENT_VERIFICATION_MISMATCH, security log)', async () => {
      gateway.verify.mockResolvedValue({ status: 'success', amountEtb: 3, currency: 'ETB' });
      await expect(post({ tx_ref: TX, status: 'success', amount: '300' })).rejects.toMatchObject({ code: ErrorCode.PAYMENT_VERIFICATION_MISMATCH, status: 400 });
      gateway.verify.mockResolvedValue({ status: 'success', amountEtb: 300, currency: 'USD' });
      await expect(post({ tx_ref: TX, status: 'success' })).rejects.toMatchObject({ code: ErrorCode.PAYMENT_VERIFICATION_MISMATCH });
      expect(wallet.applyEntry).not.toHaveBeenCalled();
      expect(security.error).toHaveBeenCalledWith('webhook.amount_mismatch', expect.objectContaining({ txRef: TX, expectedEtb: 300 }));
    });

    it('a "failed" webhook marks the payment failed ONLY when verify() confirms the failure', async () => {
      gateway.verify.mockResolvedValue({ status: 'failed' });
      expect(await post({ tx_ref: TX, status: 'failed' })).toMatchObject({ status: 'failed' });
      expect(prisma.advertiserPayment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { txRef: TX, status: 'pending' }, data: expect.objectContaining({ status: 'failed' }) }));

      prisma.advertiserPayment.updateMany.mockClear();
      gateway.verify.mockResolvedValue({ status: 'pending' });
      expect(await post({ tx_ref: TX, status: 'failed' })).toMatchObject({ status: 'pending' });
      expect(prisma.advertiserPayment.updateMany).not.toHaveBeenCalled();
      expect(security.info).toHaveBeenCalledWith('webhook.verification_pending', expect.objectContaining({ txRef: TX }));

      // a lying "failed" body for a payment the gateway actually completed settles it
      gateway.verify.mockResolvedValue({ status: 'success', amountEtb: 300, currency: 'ETB' });
      expect(await post({ tx_ref: TX, status: 'failed' })).toMatchObject({ status: 'completed' });
      expect(wallet.applyEntry).toHaveBeenCalledTimes(1);
    });

    it('a webhook for an already-settled payment is a no-op', async () => {
      prisma.advertiserPayment.findUnique.mockResolvedValue({ ...payment, status: 'completed' });
      expect(await post({ tx_ref: TX, status: 'success' })).toMatchObject({ status: 'completed' });
      expect(gateway.verify).not.toHaveBeenCalled();
      expect(wallet.applyEntry).not.toHaveBeenCalled();
    });
  });
});
