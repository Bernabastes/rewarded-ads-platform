import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ErrorCode } from '@rap/shared';
import { randomBytes } from 'node:crypto';
import { AppException } from '../../common/errors/app.exception';
import { pageArgs, paginated } from '../../common/pagination';
import { AppConfig } from '../../config/app-config';
import { SecurityLogger } from '../../infra/logger/logger.module';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WalletService } from '../wallet/wallet.module';
import { PAYMENT_GATEWAY, type PaymentGateway } from './gateway/chapa.gateway';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly wallet: WalletService,
    private readonly audit: AuditService,
    private readonly security: SecurityLogger,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  balance(advertiserId: string) {
    return this.wallet.getBalance(advertiserId);
  }

  ledger(advertiserId: string, query: { page?: number; limit?: number }) {
    return this.wallet.listEntries(advertiserId, query);
  }

  async createTopup(advertiserId: string, amountEtb: number, returnUrl?: string) {
    if (amountEtb < this.config.platform.minTopupEtb) {
      throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, `Minimum top-up is ${this.config.platform.minTopupEtb} ETB`);
    }
    const advertiser = await this.prisma.advertiser.findUniqueOrThrow({ where: { id: advertiserId } });
    const txRef = `RAP-${Date.now().toString(36).toUpperCase()}-${randomBytes(4).toString('hex').toUpperCase()}`;
    const payment = await this.prisma.advertiserPayment.create({
      data: { advertiserId, amountEtb: new Prisma.Decimal(amountEtb), txRef, gateway: this.gateway.name, mock: this.gateway.isMock },
    });
    const [firstName, ...rest] = advertiser.businessName.split(' ');
    try {
      const checkout = await this.gateway.createCheckout({
        txRef,
        amountEtb,
        currency: 'ETB',
        email: advertiser.contactEmail,
        firstName: firstName || 'Advertiser',
        lastName: rest.join(' ') || 'Account',
        phoneNumber: advertiser.contactPhone,
        returnUrl: returnUrl ?? `${this.config.env.ADVERTISER_WEB_URL}/billing?topup=${txRef}`,
        callbackUrl: `${this.config.env.API_PUBLIC_URL}/api/v1/billing/webhooks/chapa`,
        title: 'RAP top-up',
        description: `Wallet top-up ${txRef}`,
      });
      const updated = await this.prisma.advertiserPayment.update({
        where: { id: payment.id },
        data: { checkoutUrl: checkout.checkoutUrl, gatewayReference: checkout.gatewayReference },
      });
      return {
        paymentId: updated.id,
        txRef,
        amountEtb: updated.amountEtb,
        status: updated.status,
        checkoutUrl: checkout.checkoutUrl,
        mock: this.gateway.isMock,
        returnUrl: returnUrl ?? `${this.config.env.ADVERTISER_WEB_URL}/billing?topup=${txRef}`,
      };
    } catch (err) {
      await this.prisma.advertiserPayment.update({ where: { id: payment.id }, data: { status: 'failed', rawWebhook: { error: (err as Error).message } } });
      this.logger.error(`Checkout creation failed for ${txRef}: ${(err as Error).message}`);
      throw new AppException(ErrorCode.SERVICE_UNAVAILABLE, 'Payment gateway unavailable; try again later', 503);
    }
  }

  async listPayments(advertiserId: string, query: { page?: number; limit?: number }) {
    const p = pageArgs(query);
    const [rows, total] = await Promise.all([
      this.prisma.advertiserPayment.findMany({ where: { advertiserId }, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take, select: this.paymentSelect }),
      this.prisma.advertiserPayment.count({ where: { advertiserId } }),
    ]);
    return paginated(rows, total, p);
  }

  async getPayment(advertiserId: string, id: string) {
    const payment = await this.prisma.advertiserPayment.findFirst({ where: { id, advertiserId }, select: this.paymentSelect });
    if (!payment) throw AppException.notFound('Payment not found', { code: ErrorCode.PAYMENT_NOT_FOUND });
    // Real gateway: opportunistically verify pending payments when the advertiser polls.
    if (payment.status === 'pending' && !this.gateway.isMock) {
      const v = await this.gateway.verify(payment.txRef).catch(() => null);
      if (v?.status === 'success') return this.settlePayment(payment.txRef, v.gatewayReference, v.raw, 'verify');
      if (v?.status === 'failed') await this.prisma.advertiserPayment.update({ where: { id }, data: { status: 'failed', rawWebhook: v.raw as Prisma.InputJsonValue } });
    }
    return payment;
  }

  /**
   * Chapa webhook: signature-verified, idempotent (settling twice is a no-op) and cross-checked with the verify API.
   */
  async handleChapaWebhook(rawBody: Buffer | undefined, body: Record<string, unknown>, headers: Record<string, string | string[] | undefined>, ip: string) {
    if (!this.config.env.CHAPA_WEBHOOK_SECRET) {
      throw new AppException(ErrorCode.SERVICE_UNAVAILABLE, 'Webhook secret not configured', 503);
    }
    if (!this.gateway.verifyWebhookSignature(rawBody ?? JSON.stringify(body), headers)) {
      this.security.warn('webhook.signature_invalid', { gateway: 'chapa', ip, txRef: body.tx_ref });
      throw AppException.unauthorized(ErrorCode.WEBHOOK_SIGNATURE_INVALID, 'Invalid webhook signature');
    }
    const txRef = String(body.tx_ref ?? body.trx_ref ?? '');
    const status = String(body.status ?? '');
    if (!txRef) throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'tx_ref missing');

    if (status !== 'success') {
      await this.prisma.advertiserPayment.updateMany({ where: { txRef, status: 'pending' }, data: { status: 'failed', rawWebhook: body as Prisma.InputJsonValue } });
      return { received: true, txRef, status: 'failed' };
    }
    if (!this.gateway.isMock) {
      const v = await this.gateway.verify(txRef);
      if (v.status !== 'success') throw AppException.badRequest(ErrorCode.PAYMENT_NOT_FOUND, 'Gateway did not confirm this payment');
    }
    const payment = await this.settlePayment(txRef, body.reference ? String(body.reference) : undefined, body, 'webhook');
    return { received: true, txRef, status: payment.status };
  }

  /** Credits the advertiser wallet exactly once per payment and issues an invoice. */
  async settlePayment(txRef: string, gatewayReference: string | undefined, raw: unknown, via: 'webhook' | 'verify' | 'mock') {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM advertiser_payments WHERE tx_ref = ${txRef} FOR UPDATE`;
      if (rows.length === 0) throw AppException.notFound('Payment not found', { code: ErrorCode.PAYMENT_NOT_FOUND });
      const payment = await tx.advertiserPayment.findUniqueOrThrow({ where: { txRef }, select: this.paymentSelect });
      if (payment.status === 'completed') return payment;
      if (payment.status !== 'pending') {
        throw AppException.conflict(ErrorCode.PAYMENT_ALREADY_PROCESSED, `Payment is ${payment.status}`);
      }
      const now = new Date();
      await this.wallet.applyEntry(
        { advertiserId: payment.advertiserId, amountEtb: payment.amountEtb, entryType: 'topup', referenceType: 'payment', referenceId: payment.id, idempotencyKey: `topup:${payment.id}`, description: `Top-up ${txRef}` },
        tx,
      );
      const updated = await tx.advertiserPayment.update({
        where: { id: payment.id },
        data: { status: 'completed', paidAt: now, gatewayReference: gatewayReference ?? payment.gatewayReference, rawWebhook: toJson(raw) },
        select: this.paymentSelect,
      });
      const vatRate = this.config.platform.invoiceVatRate;
      const subtotal = payment.amountEtb.div(1 + vatRate).toDecimalPlaces(2);
      const vat = payment.amountEtb.minus(subtotal);
      await tx.invoice.create({
        data: {
          advertiserId: payment.advertiserId,
          invoiceNumber: `INV-${now.getUTCFullYear()}-${payment.id.slice(0, 8).toUpperCase()}`,
          status: 'paid',
          subtotalEtb: subtotal,
          vatEtb: vat,
          totalEtb: payment.amountEtb,
          lineItems: [{ description: `Advertising wallet top-up (${txRef})`, quantity: 1, unitPriceEtb: Number(subtotal), totalEtb: Number(subtotal) }],
          paymentId: payment.id,
          paidAt: now,
        },
      });
      await this.audit.record(
        { actorType: 'system', action: `payment.settled_${via}`, targetType: 'advertiser_payment', targetId: payment.id, before: { status: 'pending' }, after: { status: 'completed', amountEtb: payment.amountEtb, gatewayReference } },
        tx,
      );
      return updated;
    });
  }

  async listInvoices(advertiserId: string, query: { page?: number; limit?: number }) {
    const p = pageArgs(query);
    const [rows, total] = await Promise.all([
      this.prisma.invoice.findMany({ where: { advertiserId }, orderBy: { issuedAt: 'desc' }, skip: p.skip, take: p.take, select: this.invoiceSelect }),
      this.prisma.invoice.count({ where: { advertiserId } }),
    ]);
    return paginated(rows, total, p);
  }

  async getInvoice(advertiserId: string, id: string) {
    const inv = await this.prisma.invoice.findFirst({ where: { id, advertiserId }, select: this.invoiceSelect });
    if (!inv) throw AppException.notFound('Invoice not found');
    return inv;
  }

  /* --------------------------- mock checkout --------------------------- */

  async mockCheckoutPage(txRef: string): Promise<string> {
    this.assertMock();
    const payment = await this.prisma.advertiserPayment.findUnique({ where: { txRef }, include: { advertiser: { select: { businessName: true } } } });
    if (!payment) throw AppException.notFound('Payment not found', { code: ErrorCode.PAYMENT_NOT_FOUND });
    const returnUrl = `${this.config.env.ADVERTISER_WEB_URL}/billing?topup=${txRef}`;
    return mockCheckoutHtml({ txRef, amount: payment.amountEtb.toFixed(2), business: payment.advertiser.businessName, status: payment.status, payUrl: `${this.config.env.API_PUBLIC_URL}/api/v1/billing/mock-checkout/${txRef}/pay`, returnUrl });
  }

  async mockCheckoutPay(txRef: string, outcome: 'success' | 'failed' = 'success') {
    this.assertMock();
    if (outcome === 'failed') {
      await this.prisma.advertiserPayment.updateMany({ where: { txRef, status: 'pending' }, data: { status: 'failed', rawWebhook: { mock: true, outcome } } });
      return { txRef, status: 'failed' as const };
    }
    const payment = await this.settlePayment(txRef, `MOCK-${txRef}`, { mock: true, outcome }, 'mock');
    return { txRef, status: payment.status, returnUrl: `${this.config.env.ADVERTISER_WEB_URL}/billing?topup=${txRef}` };
  }

  private assertMock() {
    if (!this.gateway.isMock) throw AppException.notFound('Not available');
  }

  private readonly paymentSelect = {
    id: true,
    advertiserId: true,
    txRef: true,
    gateway: true,
    amountEtb: true,
    currency: true,
    status: true,
    mock: true,
    checkoutUrl: true,
    gatewayReference: true,
    paidAt: true,
    createdAt: true,
  } satisfies Prisma.AdvertiserPaymentSelect;

  private readonly invoiceSelect = {
    id: true,
    invoiceNumber: true,
    status: true,
    subtotalEtb: true,
    vatEtb: true,
    totalEtb: true,
    currency: true,
    lineItems: true,
    paymentId: true,
    issuedAt: true,
    paidAt: true,
  } satisfies Prisma.InvoiceSelect;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function mockCheckoutHtml(p: { txRef: string; amount: string; business: string; status: string; payUrl: string; returnUrl: string }): string {
  const paid = p.status === 'completed';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Mock Chapa Checkout</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:grid;place-items:center;min-height:100vh;margin:0}
.card{background:#1e293b;padding:32px;border-radius:16px;max-width:420px;width:92%;box-shadow:0 20px 60px rgba(0,0,0,.4)}
h1{font-size:18px;margin:0 0 4px}.tag{display:inline-block;background:#f59e0b;color:#111;font-weight:700;font-size:11px;padding:2px 8px;border-radius:999px;margin-bottom:16px}
.amt{font-size:36px;font-weight:700;margin:12px 0}.muted{color:#94a3b8;font-size:13px}
button{width:100%;padding:14px;border:0;border-radius:10px;font-size:16px;font-weight:600;cursor:pointer;margin-top:12px}
.pay{background:#22c55e;color:#052e16}.fail{background:#334155;color:#e2e8f0}</style></head>
<body><div class="card"><span class="tag">MOCK GATEWAY - NO REAL MONEY</span>
<h1>Pay ${p.business}</h1><div class="muted">Reference ${p.txRef}</div>
<div class="amt">ETB ${p.amount}</div>
${
  paid
    ? `<p>This payment is already <b>completed</b>.</p><a href="${p.returnUrl}"><button class="pay">Return to portal</button></a>`
    : `<p class="muted">This page simulates Chapa's hosted checkout. Choose an outcome:</p>
<button class="pay" onclick="pay('success')">Pay ETB ${p.amount}</button>
<button class="fail" onclick="pay('failed')">Simulate failure</button>
<p id="msg" class="muted"></p>
<script>async function pay(outcome){const m=document.getElementById('msg');m.textContent='Processing...';
const r=await fetch('${p.payUrl}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({outcome})});
const j=await r.json();m.textContent='Result: '+(j.status||JSON.stringify(j));if(j.status==='completed'){setTimeout(()=>location.href='${p.returnUrl}',800)}}</script>`
}
</div></body></html>`;
}
