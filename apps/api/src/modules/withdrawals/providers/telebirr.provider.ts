import { Injectable, Logger } from '@nestjs/common';
import type { PayoutMethod } from '@prisma/client';
import { AppConfig } from '../../../config/app-config';
import {
  mockPayoutId,
  mockPayoutStatus,
  type PayoutOptions,
  type PayoutProvider,
  type PayoutResult,
  type PayoutStatus,
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
 */
@Injectable()
export class TelebirrPayoutProvider implements PayoutProvider {
  readonly name = 'telebirr';
  readonly supportedMethods: readonly PayoutMethod[] = ['telebirr'];
  private readonly logger = new Logger(TelebirrPayoutProvider.name);

  constructor(private readonly config: AppConfig) {}

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
    const res = await fetch(
      `${this.config.env.TELEBIRR_BASE_URL}/apiaccess/payment/gateway/payment/v1/disbursement`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-APP-Key': this.config.env.TELEBIRR_APP_KEY!,
          Authorization: token,
        },
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
      },
    );
    const json = (await res.json()) as {
      code?: string;
      msg?: string;
      result?: { transactionNo?: string; status?: string };
    };
    if (!res.ok || json.code !== '0' || !json.result?.transactionNo) {
      throw new Error(`telebirr disbursement failed: ${json.msg ?? res.status}`);
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
    const res = await fetch(
      `${this.config.env.TELEBIRR_BASE_URL}/apiaccess/payment/gateway/payment/v1/disbursement/${encodeURIComponent(payoutId)}`,
      {
        headers: { 'X-APP-Key': this.config.env.TELEBIRR_APP_KEY!, Authorization: token },
      },
    );
    const json = (await res.json()) as {
      code?: string;
      msg?: string;
      result?: { status?: string; failReason?: string };
    };
    const status = mapTelebirrStatus(json.result?.status);
    return {
      status,
      failureReason: status === 'failed' ? (json.result?.failReason ?? json.msg) : undefined,
      raw: json,
    };
  }

  private async token(): Promise<string> {
    const res = await fetch(
      `${this.config.env.TELEBIRR_BASE_URL}/apiaccess/payment/gateway/payment/v1/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-APP-Key': this.config.env.TELEBIRR_APP_KEY! },
        body: JSON.stringify({ appSecret: this.config.env.TELEBIRR_APP_ID }),
      },
    );
    const json = (await res.json()) as { token?: string; msg?: string };
    if (!res.ok || !json.token) throw new Error(`telebirr token failed: ${json.msg ?? res.status}`);
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
