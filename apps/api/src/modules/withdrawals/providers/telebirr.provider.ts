import { Injectable, Logger } from '@nestjs/common';
import type { PayoutMethod } from '@prisma/client';
import { AppConfig } from '../../../config/app-config';
import {
  classifyHttpStatus,
  DestinationNotFoundError,
  fetchWithTimeout,
  mockAccountName,
  mockDestinationExists,
  mockPayoutId,
  mockPayoutStatus,
  type PayoutOptions,
  type PayoutProvider,
  PayoutProviderError,
  type PayoutResult,
  type PayoutStatus,
  type ResolvedAccount,
} from './payout-provider';

/**
 * telebirr business (B2C disbursement) provider.
 *
 * REAL mode (TELEBIRR_APP_ID + TELEBIRR_APP_KEY + TELEBIRR_SHORT_CODE set and PAYOUTS_MOCK=false): calls the
 * Ethio Telecom telebirr open API — token exchange followed by a fund-transfer request and a status query.
 * Endpoint paths/field names follow the public telebirr merchant integration guide and MUST be confirmed against the
 * contract-specific documentation received from Ethio Telecom before go-live (see ARCHITECTURE.md "Mocks").
 *
 * MOCK mode: simulates asynchronous processing with a configurable failure rate. Clearly labelled in logs and ids.
 *
 * Every HTTP call is time-boxed (PAYOUT_PROVIDER_TIMEOUT_MS) and failures are classified definitive/ambiguous
 * (security audit #7) so the worker never fails over or refunds while a transfer may be in flight.
 */
@Injectable()
export class TelebirrPayoutProvider implements PayoutProvider {
  readonly name = 'telebirr';
  readonly supportedMethods: readonly PayoutMethod[] = ['telebirr'];
  private readonly logger = new Logger(TelebirrPayoutProvider.name);

  constructor(
    private readonly config: AppConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get isMock(): boolean {
    const e = this.config.env;
    return e.PAYOUTS_MOCK || !(e.TELEBIRR_APP_ID && e.TELEBIRR_APP_KEY && e.TELEBIRR_SHORT_CODE);
  }

  isAvailable(): boolean {
    return true;
  }

  async initiatePayout(
    userId: string,
    amountEtb: number,
    destination: string,
    options?: PayoutOptions,
  ): Promise<PayoutResult> {
    if (this.isMock) {
      const id = mockPayoutId('TB');
      this.logger.log(
        `[MOCK telebirr] payout ${id}: ${amountEtb} ETB -> ${destination} (user ${userId}, ref ${options?.reference})`,
      );
      return {
        providerPayoutId: id,
        status: 'processing',
        message: 'MOCK: accepted for processing',
        raw: { mock: true },
      };
    }
    const token = await this.token();
    const res = await this.call('/apiaccess/payment/gateway/payment/v1/disbursement', {
      method: 'POST',
      headers: this.headers(token),
      body: JSON.stringify({
        merchantCode: this.config.env.TELEBIRR_SHORT_CODE,
        outTradeNo: options?.reference,
        receiverMsisdn: destination.replace('+', ''),
        amount: amountEtb.toFixed(2),
        currency: 'ETB',
        remark: 'Rewarded Ads Platform withdrawal',
        timestamp: Date.now(),
        nonce: Math.random().toString(36).slice(2),
      }),
    });
    const json = await this.json<{ code?: string; msg?: string; result?: { transactionNo?: string; status?: string } }>(res);
    if (!res.ok) throw new PayoutProviderError(`telebirr disbursement failed: ${json.msg ?? res.status}`, classifyHttpStatus(res.status), this.name, res.status);
    if (json.code !== '0' || !json.result?.transactionNo) {
      // a well-formed business rejection ("code != 0") means nothing was sent
      throw new PayoutProviderError(`telebirr disbursement rejected: ${json.msg ?? json.code}`, 'definitive', this.name, res.status);
    }
    return {
      providerPayoutId: json.result.transactionNo,
      status: mapTelebirrStatus(json.result.status),
      raw: json,
    };
  }

  async checkStatus(payoutId: string): Promise<PayoutStatus> {
    if (this.isMock) {
      return mockPayoutStatus(
        payoutId,
        this.config.env.PAYOUT_MOCK_PROCESSING_SECONDS,
        this.config.env.PAYOUT_MOCK_FAILURE_RATE,
      );
    }
    const token = await this.token();
    const res = await this.call(`/apiaccess/payment/gateway/payment/v1/disbursement/${encodeURIComponent(payoutId)}`, {
      headers: this.headers(token),
    });
    const json = await this.json<{ code?: string; msg?: string; result?: { status?: string; failReason?: string } }>(res);
    if (!res.ok) throw new PayoutProviderError(`telebirr status query failed: ${json.msg ?? res.status}`, classifyHttpStatus(res.status), this.name, res.status);
    const status = mapTelebirrStatus(json.result?.status);
    return {
      status,
      failureReason: status === 'failed' ? (json.result?.failReason ?? json.msg) : undefined,
      raw: json,
    };
  }

  /**
   * Looks a disbursement up by OUR reference (`outTradeNo`) after an ambiguous failure. Endpoint and field names
   * follow the merchant guide's "query by merchant order" and MUST be confirmed with Ethio Telecom.
   * MOCK mode: the partner has no record (null) - the registry then parks the withdrawal for manual review.
   */
  async findByReference(reference: string): Promise<(PayoutStatus & { providerPayoutId: string }) | null> {
    if (this.isMock) return null;
    const token = await this.token();
    const res = await this.call(`/apiaccess/payment/gateway/payment/v1/disbursement/query?outTradeNo=${encodeURIComponent(reference)}`, {
      headers: this.headers(token),
    });
    if (res.status === 404) return null;
    const json = await this.json<{ code?: string; msg?: string; result?: { transactionNo?: string; status?: string; failReason?: string } }>(res);
    if (!res.ok) throw new PayoutProviderError(`telebirr reference query failed: ${json.msg ?? res.status}`, classifyHttpStatus(res.status), this.name, res.status);
    if (json.code === 'NOT_FOUND' || !json.result?.transactionNo) return null;
    const status = mapTelebirrStatus(json.result.status);
    return { providerPayoutId: json.result.transactionNo, status, failureReason: status === 'failed' ? json.result.failReason : undefined, raw: json };
  }

  /**
   * telebirr customer name enquiry (used before paying out to a NEW destination).
   * REAL mode: `POST .../payment/v1/customer/query { msisdn }` -> `{ result: { customerName } }` — endpoint and field
   * names follow the merchant integration guide and MUST be confirmed with Ethio Telecom before go-live.
   * MOCK mode: deterministic Ethiopian name; destinations ending in 0000 are "not found".
   */
  async resolveAccount(_method: PayoutMethod, destination: string): Promise<ResolvedAccount> {
    const normalized = destination.startsWith('+') ? destination : `+${destination.replace(/^0/, '251')}`;
    if (this.isMock) {
      if (!mockDestinationExists(normalized)) throw new DestinationNotFoundError();
      return { accountName: mockAccountName(normalized), normalizedDestination: normalized, raw: { mock: true } };
    }
    const token = await this.token();
    const res = await this.call('/apiaccess/payment/gateway/payment/v1/customer/query', {
      method: 'POST',
      headers: this.headers(token),
      body: JSON.stringify({ merchantCode: this.config.env.TELEBIRR_SHORT_CODE, msisdn: normalized.replace('+', '') }),
    });
    const json = await this.json<{ code?: string; msg?: string; result?: { customerName?: string } }>(res);
    if (res.status === 404 || json.code === 'NOT_FOUND') throw new DestinationNotFoundError(json.msg);
    if (!res.ok || json.code !== '0' || !json.result?.customerName) {
      throw new PayoutProviderError(`telebirr customer query failed: ${json.msg ?? res.status}`, classifyHttpStatus(res.status), this.name, res.status);
    }
    return { accountName: json.result.customerName, normalizedDestination: normalized, raw: json };
  }

  private headers(token: string): Record<string, string> {
    return { 'Content-Type': 'application/json', 'X-APP-Key': this.config.env.TELEBIRR_APP_KEY!, Authorization: token };
  }

  private call(path: string, init: RequestInit): Promise<Response> {
    return fetchWithTimeout(this.name, `${this.config.env.TELEBIRR_BASE_URL}${path}`, init, this.config.env.PAYOUT_PROVIDER_TIMEOUT_MS, this.fetchImpl);
  }

  private async json<T>(res: Response): Promise<T> {
    try {
      return (await res.json()) as T;
    } catch (err) {
      throw new PayoutProviderError(`telebirr returned a malformed reply (HTTP ${res.status}): ${(err as Error).message}`, 'ambiguous', this.name, res.status);
    }
  }

  private async token(): Promise<string> {
    const res = await this.call('/apiaccess/payment/gateway/payment/v1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-APP-Key': this.config.env.TELEBIRR_APP_KEY! },
      body: JSON.stringify({ appSecret: this.config.env.TELEBIRR_APP_ID }),
    });
    const json = await this.json<{ token?: string; msg?: string }>(res);
    // the token exchange happens BEFORE any transfer request, so its failure is always definitive
    if (!res.ok || !json.token) throw new PayoutProviderError(`telebirr token failed: ${json.msg ?? res.status}`, 'definitive', this.name, res.status);
    return json.token;
  }
}

function mapTelebirrStatus(status?: string): PayoutResult['status'] {
  switch ((status ?? '').toUpperCase()) {
    case 'SUCCESS':
    case 'COMPLETED':
      return 'completed';
    case 'FAILED':
    case 'FAIL':
    case 'REJECTED':
      return 'failed';
    case 'PENDING':
      return 'pending';
    default:
      return 'processing';
  }
}
