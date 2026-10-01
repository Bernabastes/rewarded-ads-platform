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

/** Chapa bank codes for mobile wallets (confirm with GET https://api.chapa.co/v1/banks before go-live). */
const CHAPA_WALLET_BANK_CODES: Partial<Record<PayoutMethod, string>> = { telebirr: '855', cbe_birr: '128' };

/**
 * Chapa Transfers API provider (https://developer.chapa.co/transfers) — pays out to bank accounts and to
 * telebirr / CBE Birr wallets, which makes it the failover partner for telebirr withdrawals.
 * REAL mode when CHAPA_SECRET_KEY is set and PAYOUTS_MOCK=false; otherwise clearly labelled MOCK mode.
 *
 * Every HTTP call is time-boxed (PAYOUT_PROVIDER_TIMEOUT_MS) and failures are classified definitive/ambiguous
 * (security audit #7). Chapa transfers are addressed by OUR reference, so `findByReference` == `checkStatus`.
 */
@Injectable()
export class ChapaPayoutProvider implements PayoutProvider {
  readonly name = 'chapa';
  readonly supportedMethods: readonly PayoutMethod[] = ['bank', 'telebirr', 'cbe_birr'];
  private readonly logger = new Logger(ChapaPayoutProvider.name);

  constructor(
    private readonly config: AppConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

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
    const res = await this.call('/transfers', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        account_name: options?.accountName ?? 'RAP user',
        account_number: destination.replace('+251', '0'),
        amount: amountEtb.toFixed(2),
        currency: 'ETB',
        reference: options?.reference,
        bank_code: bankCode,
      }),
    });
    const json = await this.json<{ status?: string; message?: string; data?: string }>(res);
    if (!res.ok) throw new PayoutProviderError(`Chapa transfer failed: ${json.message ?? res.status}`, classifyHttpStatus(res.status), this.name, res.status);
    if (json.status !== 'success') throw new PayoutProviderError(`Chapa transfer rejected: ${json.message ?? json.status}`, 'definitive', this.name, res.status);
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
    const res = await this.call(`/transfers/verify/${encodeURIComponent(payoutId)}`, { headers: this.headers() });
    const json = await this.json<{ status?: string; message?: string; data?: { status?: string; failure_reason?: string } }>(res);
    if (!res.ok) throw new PayoutProviderError(`Chapa transfer verify failed: ${json.message ?? res.status}`, classifyHttpStatus(res.status), this.name, res.status);
    const s = (json.data?.status ?? '').toLowerCase();
    const status: PayoutStatus['status'] =
      s === 'success' ? 'completed' : s === 'failed' || s === 'reversed' ? 'failed' : 'processing';
    return {
      status,
      failureReason: status === 'failed' ? (json.data?.failure_reason ?? json.message) : undefined,
      raw: json,
    };
  }

  /** Chapa addresses transfers by our reference: a 404 from verify means the transfer was never accepted. */
  async findByReference(reference: string): Promise<(PayoutStatus & { providerPayoutId: string }) | null> {
    if (this.isMock) return null;
    const res = await this.call(`/transfers/verify/${encodeURIComponent(reference)}`, { headers: this.headers() });
    if (res.status === 404) return null;
    const json = await this.json<{ status?: string; message?: string; data?: { status?: string; failure_reason?: string } }>(res);
    if (!res.ok) throw new PayoutProviderError(`Chapa transfer lookup failed: ${json.message ?? res.status}`, classifyHttpStatus(res.status), this.name, res.status);
    if (!json.data) return null;
    const s = (json.data.status ?? '').toLowerCase();
    const status: PayoutStatus['status'] = s === 'success' ? 'completed' : s === 'failed' || s === 'reversed' ? 'failed' : 'processing';
    return { providerPayoutId: reference, status, failureReason: status === 'failed' ? json.data.failure_reason : undefined, raw: json };
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
    const res = await this.call('/transfers/verify-account', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        account_number: method === 'bank' ? normalized : normalized.replace('+251', '0'),
        bank_code: bankCode ?? CHAPA_WALLET_BANK_CODES[method],
      }),
    });
    const json = await this.json<{ status?: string; message?: string; data?: { account_name?: string } }>(res);
    if (res.status === 404 || /not found/i.test(json.message ?? '')) throw new DestinationNotFoundError(json.message);
    if (!res.ok || json.status !== 'success' || !json.data?.account_name) {
      throw new PayoutProviderError(`Chapa account verification failed: ${json.message ?? res.status}`, classifyHttpStatus(res.status), this.name, res.status);
    }
    return { accountName: json.data.account_name, normalizedDestination: normalized, raw: json };
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.config.env.CHAPA_SECRET_KEY}`, 'Content-Type': 'application/json' };
  }

  private call(path: string, init: RequestInit): Promise<Response> {
    return fetchWithTimeout(this.name, `${this.config.env.CHAPA_BASE_URL}${path}`, init, this.config.env.PAYOUT_PROVIDER_TIMEOUT_MS, this.fetchImpl);
  }

  private async json<T>(res: Response): Promise<T> {
    try {
      return (await res.json()) as T;
    } catch (err) {
      throw new PayoutProviderError(`Chapa returned a malformed reply (HTTP ${res.status}): ${(err as Error).message}`, 'ambiguous', this.name, res.status);
    }
  }
}
