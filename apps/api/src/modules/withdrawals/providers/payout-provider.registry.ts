import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PayoutMethod } from '@prisma/client';
import { SecurityLogger } from '../../../infra/logger/logger.module';
import {
  DestinationNotFoundError,
  PAYOUT_PROVIDERS,
  type PayoutOptions,
  PayoutOutcomeUnknownError,
  type PayoutProvider,
  PayoutProviderError,
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

  /**
   * Routes a payout with failover (security audit #7):
   *  - a DEFINITIVE failure (unreachable before the request left, 4xx validation / business rejection) means the
   *    partner never accepted the transfer -> try the next provider;
   *  - an AMBIGUOUS failure (timeout, 5xx, reset, malformed reply) means the partner MAY have accepted it -> query
   *    the partner by our reference first; a record => continue with it (no double payout), no record => the
   *    transfer was not accepted => fail over, cannot tell => PayoutOutcomeUnknownError (manual review, no refund).
   */
  async initiateWithFailover(
    method: PayoutMethod,
    userId: string,
    amountEtb: number,
    destination: string,
    options: PayoutOptions,
  ): Promise<{ provider: PayoutProvider; result: PayoutResult }> {
    const candidates = this.providersFor(method).filter((p) => p.isAvailable());
    if (candidates.length === 0) {
      throw new PayoutProviderError(`No payout provider available for method ${method}`, 'definitive', 'registry');
    }
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
        const error = err as Error;
        const kind = err instanceof PayoutProviderError ? err.kind : 'ambiguous';
        this.logger.warn(`Payout provider ${provider.name} failed (${kind}) for ${options.reference}: ${error.message}`);
        if (kind === 'definitive') {
          lastError = error;
          continue;
        }
        // Ambiguous: ask the partner whether it has our reference before doing anything else with the money.
        const known = await this.lookupAfterAmbiguousFailure(provider, options.reference, error);
        if (known) return { provider, result: known };
        lastError = error; // partner confirmed "no such transfer" -> safe to try the next provider
      }
    }
    throw lastError ?? new PayoutProviderError('Payout failed', 'definitive', 'registry');
  }

  /** Returns the partner's record of the transfer, null when it has none, or throws PayoutOutcomeUnknownError. */
  private async lookupAfterAmbiguousFailure(provider: PayoutProvider, reference: string, cause: Error): Promise<PayoutResult | null> {
    let found: Awaited<ReturnType<PayoutProvider['findByReference']>>;
    try {
      found = await provider.findByReference(reference);
    } catch (lookupErr) {
      this.security.error('payout.outcome_unknown', { provider: provider.name, reference, error: cause.message, lookupError: (lookupErr as Error).message });
      throw new PayoutOutcomeUnknownError(provider.name, reference, cause);
    }
    if (found === null) return null;
    this.security.warn('payout.outcome_unknown', {
      provider: provider.name,
      reference,
      error: cause.message,
      resolvedByLookup: found.status,
    });
    return { providerPayoutId: found.providerPayoutId, status: found.status, message: found.failureReason, raw: found.raw };
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
