import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Withdrawal } from '@prisma/client';
import { type Job, Queue } from 'bullmq';
import { AppConfig } from '../../config/app-config';
import { QUEUE_PAYOUTS } from '../../infra/queue/queue.module';
import { PayoutOutcomeUnknownError, PayoutProviderError, type PayoutResult, type PayoutStatus } from './providers/payout-provider';
import { PayoutProviderRegistry } from './providers/payout-provider.registry';
import { WithdrawalsService } from './withdrawals.service';

type InitiateJob = { withdrawalId: string };
type PollJob = { withdrawalId: string; providerName: string; payoutId: string; polls: number; statusErrors?: number };

/** Consecutive status-query failures tolerated before the payout is parked for manual review. */
export const MAX_CONSECUTIVE_STATUS_ERRORS = 10;

/**
 * Payout worker: pending -> processing -> completed | failed | needs_manual_review.
 * `initiate` calls the provider registry (failover only on definitive pre-send errors); `poll` checks the partner
 * status until terminal. Whenever the partner's outcome cannot be established (ambiguous error without a record,
 * exhausted polling, unknown provider) the withdrawal is parked as `needs_manual_review` with the coins still
 * held - it is NEVER auto-refunded while money may be in flight (security audit #7).
 */
@Processor(QUEUE_PAYOUTS, { concurrency: 5 })
export class PayoutProcessor extends WorkerHost {
  private readonly logger = new Logger(PayoutProcessor.name);

  constructor(
    private readonly withdrawals: WithdrawalsService,
    private readonly registry: PayoutProviderRegistry,
    private readonly config: AppConfig,
    @InjectQueue(QUEUE_PAYOUTS) private readonly queue: Queue,
  ) {
    super();
  }

  async process(job: Job<InitiateJob | PollJob>) {
    if (job.name === 'initiate') return this.initiate(job as Job<InitiateJob>);
    if (job.name === 'poll') return this.poll(job as Job<PollJob>);
    this.logger.warn(`Unknown payout job ${job.name}`);
  }

  async initiate(job: Job<InitiateJob>) {
    const w = await this.withdrawals.markProcessing(job.data.withdrawalId);
    if (w) return this.send(w);
    // Phase 5b New-2: a retried job (BullMQ attempts) may find the row already `processing` without a partner -
    // the previous attempt crashed somewhere between the claim and setProvider and MAY have sent the transfer.
    const stuck = await this.withdrawals.findProcessingWithoutProvider(job.data.withdrawalId);
    if (!stuck) {
      this.logger.debug(`Withdrawal ${job.data.withdrawalId} is not pending; skipping`);
      return;
    }
    this.logger.warn(`Withdrawal ${stuck.id}: resuming an interrupted initiation (attempt ${job.attemptsMade + 1})`);
    try {
      const existing = await this.registry.findExisting(stuck.payoutMethod, stuck.id);
      if (existing) return this.adopt(stuck, existing.provider.name, existing.result);
    } catch (err) {
      if (err instanceof PayoutOutcomeUnknownError) {
        await this.withdrawals.setProvider(stuck.id, err.providerName, stuck.id, { outcomeUnknown: true, error: err.cause.message });
        return this.withdrawals.markNeedsManualReview(
          stuck.id,
          `Initiation was interrupted and partner ${err.providerName} could not confirm whether a transfer exists (${err.cause.message})`,
        );
      }
      return this.withdrawals.markNeedsManualReview(stuck.id, `Initiation was interrupted and the recovery lookup failed: ${(err as Error).message}`);
    }
    // every partner explicitly answered "no such order": safe to send now
    return this.send(stuck);
  }

  /** Sends through the registry and records the outcome. Only a DEFINITIVE failure of every provider refunds. */
  private async send(w: Pick<Withdrawal, 'id' | 'userId' | 'payoutMethod' | 'amountEtb' | 'payoutDestination' | 'destinationName' | 'bankCode'>) {
    try {
      const { provider, result } = await this.registry.initiateWithFailover(
        w.payoutMethod,
        w.userId,
        Number(w.amountEtb),
        w.payoutDestination,
        {
          reference: w.id,
          accountName: w.destinationName ?? undefined,
          bankCode: w.bankCode ?? undefined,
        },
      );
      return await this.adopt(w, provider.name, result);
    } catch (err) {
      if (err instanceof PayoutOutcomeUnknownError) {
        await this.withdrawals.setProvider(w.id, err.providerName, w.id, { outcomeUnknown: true, error: err.cause.message });
        return this.withdrawals.markNeedsManualReview(
          w.id,
          `Partner ${err.providerName} did not confirm whether the transfer was accepted (${err.cause.message})`,
        );
      }
      if (err instanceof PayoutProviderError && err.kind === 'definitive') {
        // Every provider failed DEFINITIVELY (nothing was sent) -> safe to refund.
        return this.withdrawals.markFailed(w.id, `All payout providers failed: ${err.message}`);
      }
      // Anything else (ambiguous provider error, bug, infrastructure failure) is NOT evidence that no money moved.
      this.logger.error(`Withdrawal ${w.id}: unexpected error during payout initiation: ${(err as Error).message}`);
      return this.withdrawals.markNeedsManualReview(w.id, `Payout initiation hit an unexpected error: ${(err as Error).message}`);
    }
  }

  /** Records the partner + transfer id and moves the withdrawal to its next state. */
  private async adopt(w: Pick<Withdrawal, 'id'>, providerName: string, result: PayoutResult) {
    await this.withdrawals.setProvider(w.id, providerName, result.providerPayoutId, result.raw ?? {});
    if (result.status === 'completed') return this.withdrawals.markCompleted(w.id, result.raw);
    if (result.status === 'failed') {
      return this.withdrawals.markFailed(w.id, result.message ?? 'Provider rejected the payout', result.raw);
    }
    await this.schedulePoll({ withdrawalId: w.id, providerName, payoutId: result.providerPayoutId, polls: 0 });
  }

  async poll(job: Job<PollJob>) {
    const provider = this.registry.byName(job.data.providerName);
    if (!provider) {
      // A transfer may exist at a partner we can no longer talk to: never refund blindly.
      return this.withdrawals.markNeedsManualReview(
        job.data.withdrawalId,
        `Provider ${job.data.providerName} is no longer registered; confirm the transfer manually`,
      );
    }
    let status: PayoutStatus;
    try {
      status = await provider.checkStatus(job.data.payoutId);
    } catch (err) {
      const statusErrors = (job.data.statusErrors ?? 0) + 1;
      this.logger.warn(`Status query for ${job.data.withdrawalId} failed (${statusErrors}): ${(err as Error).message}`);
      if (statusErrors >= MAX_CONSECUTIVE_STATUS_ERRORS) {
        return this.withdrawals.markNeedsManualReview(
          job.data.withdrawalId,
          `Partner ${provider.name} status query kept failing: ${(err as Error).message}`,
        );
      }
      return this.schedulePoll({ ...job.data, polls: job.data.polls + 1, statusErrors });
    }
    if (status.status === 'completed')
      return this.withdrawals.markCompleted(job.data.withdrawalId, status.raw);
    if (status.status === 'failed')
      return this.withdrawals.markFailed(
        job.data.withdrawalId,
        status.failureReason ?? 'Payout failed at provider',
        status.raw,
      );
    if (job.data.polls + 1 >= this.config.env.PAYOUT_MAX_POLLS) {
      return this.withdrawals.markNeedsManualReview(
        job.data.withdrawalId,
        `Partner ${provider.name} status stayed non-final after ${job.data.polls + 1} polls`,
        status.raw,
      );
    }
    await this.schedulePoll({ ...job.data, polls: job.data.polls + 1, statusErrors: 0 });
  }

  private async schedulePoll(data: PollJob) {
    await this.queue.add('poll', data, {
      delay: this.config.env.PAYOUT_STATUS_POLL_SECONDS * 1000,
      jobId: `poll-${data.withdrawalId}-${data.polls}`,
      attempts: 5,
    });
  }
}
