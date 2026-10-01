import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { type Job, Queue } from 'bullmq';
import { AppConfig } from '../../config/app-config';
import { QUEUE_PAYOUTS } from '../../infra/queue/queue.module';
import { PayoutOutcomeUnknownError, type PayoutStatus } from './providers/payout-provider';
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
    if (!w) {
      this.logger.debug(`Withdrawal ${job.data.withdrawalId} is not pending; skipping`);
      return;
    }
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
      await this.withdrawals.setProvider(w.id, provider.name, result.providerPayoutId, result.raw ?? {});
      if (result.status === 'completed') return this.withdrawals.markCompleted(w.id, result.raw);
      if (result.status === 'failed')
        return this.withdrawals.markFailed(
          w.id,
          result.message ?? 'Provider rejected the payout',
          result.raw,
        );
      await this.schedulePoll({
        withdrawalId: w.id,
        providerName: provider.name,
        payoutId: result.providerPayoutId,
        polls: 0,
      });
    } catch (err) {
      if (err instanceof PayoutOutcomeUnknownError) {
        await this.withdrawals.setProvider(w.id, err.providerName, w.id, { outcomeUnknown: true, error: err.cause.message });
        return this.withdrawals.markNeedsManualReview(
          w.id,
          `Partner ${err.providerName} did not confirm whether the transfer was accepted (${err.cause.message})`,
        );
      }
      // Every provider failed DEFINITIVELY (nothing was sent) -> safe to refund.
      await this.withdrawals.markFailed(w.id, `All payout providers failed: ${(err as Error).message}`);
    }
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
