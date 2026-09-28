import { Injectable, Logger } from '@nestjs/common';
import type { PayoutMethod } from '@prisma/client';
import { AppConfig } from '../../../config/app-config';
import {
  DestinationNotFoundError,
  mockAccountName,
  mockDestinationExists,
  mockPayoutId,
  mockPayoutStatus,
  type PayoutOptions,
  type PayoutProvider,
  type PayoutResult,
  type PayoutStatus,
  type ResolvedAccount,
} from './payout-provider';

/** Chapa bank codes for mobile wallets (confirm with GET https://api.chapa.co/v1/banks before go-live). */
const CHAPA_WALLET_BANK_CODES: Partial<Record<PayoutMethod, string>> = { telebirr: '855', cbe_birr: '128' };

/**
 * Chapa Transfers API provider (https://developer.chapa.co/transfers) — pays out to bank accounts and to
 * telebirr / CBE Birr wallets, which makes it the failover partner for telebirr withdrawals.
 * REAL mode when CHAPA_SECRET_KEY is set and PAYOUTS_MOCK=false; otherwise clearly labelled MOCK mode.
 */
@Injectable()
export class ChapaPayoutProvider implements PayoutProvider {
  readonly name = 'chapa';
  readonly supportedMethods: readonly PayoutMethod[] = ['bank', 'telebirr', 'cbe_birr'];
  private readonly logger = new Logger(ChapaPayoutProvider.name);

  constructor(private readonly config: AppConfig) {}

  get isMock(): boolean {
    return this.config.env.PAYOUTS_MOCK || !this.config.env.CHAPA_SECRET_KEY;
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
      const id = mockPayoutId('CH');
      this.logger.log(
        `[MOCK chapa] transfer ${id}: ${amountEtb} ETB -> ${destination} (user ${userId}, ref ${options?.reference})`,
      );
      return {
        providerPayoutId: id,
        status: 'processing',
        message: 'MOCK: transfer queued',
        raw: { mock: true },
      };
    }
    const bankCode = options?.bankCode ?? CHAPA_WALLET_BANK_CODES.telebirr;
    const res = await fetch(`${this.config.env.CHAPA_BASE_URL}/transfers`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.env.CHAPA_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        account_name: options?.accountName ?? 'RAP user',
        account_number: destination.replace('+251', '0'),
        amount: amountEtb.toFixed(2),
        currency: 'ETB',
        reference: options?.reference,
        bank_code: bankCode,
      }),
    });
    const json = (await res.json()) as { status?: string; message?: string; data?: string };
    if (!res.ok || json.status !== 'success')
      throw new Error(`Chapa transfer failed: ${json.message ?? res.status}`);
    return { providerPayoutId: options?.reference ?? String(json.data), status: 'processing', raw: json };
  }

  async checkStatus(payoutId: string): Promise<PayoutStatus> {
    if (this.isMock) {
      return mockPayoutStatus(
        payoutId,
        this.config.env.PAYOUT_MOCK_PROCESSING_SECONDS,
        this.config.env.PAYOUT_MOCK_FAILURE_RATE,
      );
    }
    const res = await fetch(
      `${this.config.env.CHAPA_BASE_URL}/transfers/verify/${encodeURIComponent(payoutId)}`,
      {
        headers: { Authorization: `Bearer ${this.config.env.CHAPA_SECRET_KEY}` },
      },
    );
    const json = (await res.json()) as {
      status?: string;
      message?: string;
      data?: { status?: string; failure_reason?: string };
    };
    const s = (json.data?.status ?? '').toLowerCase();
    const status: PayoutStatus['status'] =
      s === 'success' ? 'completed' : s === 'failed' || s === 'reversed' ? 'failed' : 'processing';
    return {
      status,
      failureReason: status === 'failed' ? (json.data?.failure_reason ?? json.message) : undefined,
      raw: json,
    };
  }

  static walletBankCode(method: PayoutMethod): string | undefined {
    return CHAPA_WALLET_BANK_CODES[method];
  }

  /**
   * Account-name enquiry before a payout to a NEW destination.
   * REAL mode: Chapa's account verification `POST /v1/transfers/verify-account { account_number, bank_code }` ->
   * `{ data: { account_name } }` (shape per Chapa Transfers docs; confirm against the current API reference).
   * MOCK mode: deterministic Ethiopian name; destinations ending in 0000 are "not found".
   */
  async resolveAccount(method: PayoutMethod, destination: string, bankCode?: string): Promise<ResolvedAccount> {
    const normalized = method === 'bank' ? destination.replace(/\s+/g, '') : destination;
    if (this.isMock) {
      if (!mockDestinationExists(normalized)) throw new DestinationNotFoundError();
      return { accountName: mockAccountName(normalized), normalizedDestination: normalized, raw: { mock: true } };
    }
    const res = await fetch(`${this.config.env.CHAPA_BASE_URL}/transfers/verify-account`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.env.CHAPA_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        account_number: method === 'bank' ? normalized : normalized.replace('+251', '0'),
        bank_code: bankCode ?? CHAPA_WALLET_BANK_CODES[method],
      }),
    });
    const json = (await res.json()) as { status?: string; message?: string; data?: { account_name?: string } };
    if (res.status === 404 || /not found/i.test(json.message ?? '')) throw new DestinationNotFoundError(json.message);
    if (!res.ok || json.status !== 'success' || !json.data?.account_name) {
      throw new Error(`Chapa account verification failed: ${json.message ?? res.status}`);
    }
    return { accountName: json.data.account_name, normalizedDestination: normalized, raw: json };
  }
}
