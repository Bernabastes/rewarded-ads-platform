import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PayoutMethod } from '@prisma/client';
import { SecurityLogger } from '../../../infra/logger/logger.module';
import {
  DestinationNotFoundError,
  PAYOUT_PROVIDERS,
  type PayoutOptions,
  type PayoutProvider,
  type PayoutResult,
  type ResolvedAccount,
} from './payout-provider';

/** Preferred provider order per payout method; later entries are failovers. */
const ROUTING: Record<PayoutMethod, string[]> = {
  telebirr: ['telebirr', 'chapa'],
  cbe_birr: ['chapa'],
  bank: ['chapa'],
};

/**
 * Routes payouts to providers by method and fails over to the next partner when one is down, so a single partner
 * outage never halts withdrawals (spec §9 technology-risk requirement).
 */
@Injectable()
export class PayoutProviderRegistry {
  private readonly logger = new Logger(PayoutProviderRegistry.name);

  constructor(
    @Inject(PAYOUT_PROVIDERS) private readonly providers: PayoutProvider[],
    private readonly security: SecurityLogger,
  ) {}

  all(): PayoutProvider[] {
    return this.providers;
  }

  byName(name: string): PayoutProvider | undefined {
    return this.providers.find((p) => p.name === name);
  }

  providersFor(method: PayoutMethod): PayoutProvider[] {
    return ROUTING[method]
      .map((name) => this.providers.find((p) => p.name === name && p.supportedMethods.includes(method)))
      .filter((p): p is PayoutProvider => Boolean(p));
  }

  isMethodAvailable(method: PayoutMethod): boolean {
    return this.providersFor(method).some((p) => p.isAvailable());
  }

  async initiateWithFailover(
    method: PayoutMethod,
    userId: string,
    amountEtb: number,
    destination: string,
    options: PayoutOptions,
  ): Promise<{ provider: PayoutProvider; result: PayoutResult }> {
    const candidates = this.providersFor(method).filter((p) => p.isAvailable());
    if (candidates.length === 0) throw new Error(`No payout provider available for method ${method}`);
    let lastError: Error | undefined;
    for (const [index, provider] of candidates.entries()) {
      try {
        const result = await provider.initiatePayout(userId, amountEtb, destination, options);
        if (index > 0) {
          this.security.warn('payout.provider_failover', {
            method,
            failedOver: candidates.slice(0, index).map((p) => p.name),
            usedProvider: provider.name,
            reference: options.reference,
          });
        }
        return { provider, result };
      } catch (err) {
        lastError = err as Error;
        this.logger.warn(
          `Payout provider ${provider.name} failed for ${options.reference}: ${lastError.message}`,
        );
      }
    }
    throw lastError ?? new Error('Payout failed');
  }

  /**
   * Account-name lookup with the same routing/failover as payouts. A DestinationNotFoundError from a provider is
   * authoritative (no failover: the account really does not exist there); other errors fail over.
   */
  async resolveWithFailover(
    method: PayoutMethod,
    destination: string,
    bankCode?: string,
  ): Promise<{ provider: PayoutProvider; result: ResolvedAccount }> {
    const candidates = this.providersFor(method).filter((p) => p.isAvailable());
    if (candidates.length === 0) throw new Error(`No payout provider available for method ${method}`);
    let lastError: Error | undefined;
    for (const provider of candidates) {
      try {
        const result = await provider.resolveAccount(method, destination, bankCode);
        return { provider, result };
      } catch (err) {
        if (err instanceof DestinationNotFoundError) throw err;
        lastError = err as Error;
        this.logger.warn(`Account lookup via ${provider.name} failed: ${lastError.message}`);
      }
    }
    throw lastError ?? new Error('Account lookup failed');
  }
}
