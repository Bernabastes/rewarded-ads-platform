import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppConfig } from '../../../config/app-config';

export interface CheckoutRequest {
  txRef: string;
  amountEtb: number;
  currency: 'ETB';
  email: string;
  firstName: string;
  lastName: string;
  phoneNumber?: string;
  returnUrl: string;
  callbackUrl: string;
  title: string;
  description: string;
}

export interface CheckoutResult {
  checkoutUrl: string;
  gatewayReference?: string;
  raw?: unknown;
}

export interface VerifyResult {
  status: 'success' | 'pending' | 'failed';
  amountEtb?: number;
  currency?: string;
  gatewayReference?: string;
  raw?: unknown;
}

/** Inbound advertiser payments (checkout) abstraction. */
export interface PaymentGateway {
  readonly name: string;
  readonly isMock: boolean;
  createCheckout(req: CheckoutRequest): Promise<CheckoutResult>;
  verify(txRef: string): Promise<VerifyResult>;
  /** Validates a webhook signature; returns false when it cannot be validated. */
  verifyWebhookSignature(rawBody: Buffer | string, headers: Record<string, string | string[] | undefined>): boolean;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

/**
 * Chapa payment gateway (https://developer.chapa.co). Uses the real API when CHAPA_SECRET_KEY is set;
 * otherwise runs in an explicitly labelled MOCK mode that serves a local fake checkout page.
 */
@Injectable()
export class ChapaGateway implements PaymentGateway {
  readonly name = 'chapa';
  private readonly logger = new Logger(ChapaGateway.name);

  constructor(private readonly config: AppConfig) {}

  get isMock() {
    return !this.config.env.CHAPA_SECRET_KEY;
  }

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    if (this.isMock) {
      this.logger.log(`[MOCK CHAPA] checkout tx_ref=${req.txRef} amount=${req.amountEtb} ETB`);
      return { checkoutUrl: `${this.config.env.API_PUBLIC_URL}/api/v1/billing/mock-checkout/${req.txRef}`, raw: { mock: true } };
    }
    const res = await fetch(`${this.config.env.CHAPA_BASE_URL}/transaction/initialize`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.config.env.CHAPA_SECRET_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: req.amountEtb.toFixed(2),
        currency: req.currency,
        email: req.email,
        first_name: req.firstName,
        last_name: req.lastName,
        phone_number: req.phoneNumber,
        tx_ref: req.txRef,
        callback_url: req.callbackUrl,
        return_url: req.returnUrl,
        customization: { title: req.title.slice(0, 16), description: req.description.slice(0, 100) },
      }),
    });
    const json = (await res.json()) as { status: string; message?: string; data?: { checkout_url?: string } };
    if (!res.ok || json.status !== 'success' || !json.data?.checkout_url) {
      throw new Error(`Chapa initialize failed: ${json.message ?? res.status}`);
    }
    return { checkoutUrl: json.data.checkout_url, raw: json };
  }

  async verify(txRef: string): Promise<VerifyResult> {
    if (this.isMock) return { status: 'pending', raw: { mock: true } };
    const res = await fetch(`${this.config.env.CHAPA_BASE_URL}/transaction/verify/${encodeURIComponent(txRef)}`, {
      headers: { Authorization: `Bearer ${this.config.env.CHAPA_SECRET_KEY}` },
    });
    const json = (await res.json()) as {
      status: string;
      data?: { status?: string; amount?: string | number; currency?: string; reference?: string };
    };
    const s = json.data?.status;
    return {
      status: s === 'success' ? 'success' : s === 'pending' ? 'pending' : 'failed',
      amountEtb: json.data?.amount !== undefined ? Number(json.data.amount) : undefined,
      currency: json.data?.currency,
      gatewayReference: json.data?.reference,
      raw: json,
    };
  }

  /**
   * Chapa signs webhooks with the dashboard "webhook secret":
   *  - `Chapa-Signature`: HMAC-SHA256(secret, raw JSON payload)
   *  - `x-chapa-signature`: HMAC-SHA256(secret, secret)
   * Either valid header is accepted.
   */
  verifyWebhookSignature(rawBody: Buffer | string, headers: Record<string, string | string[] | undefined>): boolean {
    const secret = this.config.env.CHAPA_WEBHOOK_SECRET;
    if (!secret) return false;
    const header = (name: string) => {
      const v = headers[name] ?? headers[name.toLowerCase()];
      return Array.isArray(v) ? v[0] : v;
    };
    const payloadSig = header('Chapa-Signature');
    const secretSig = header('x-chapa-signature');
    const expectedPayload = createHmac('sha256', secret).update(rawBody).digest('hex');
    const expectedSecret = createHmac('sha256', secret).update(secret).digest('hex');
    return safeEqual(payloadSig, expectedPayload) || safeEqual(secretSig, expectedSecret);
  }
}

function safeEqual(a: string | undefined, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
