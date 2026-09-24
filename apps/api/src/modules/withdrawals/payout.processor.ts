import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { type Job, Queue } from 'bullmq';
import { AppConfig } from '../../config/app-config';
import { QUEUE_PAYOUTS } from '../../infra/queue/queue.module';
import { PayoutProviderRegistry } from './providers/payout-provider.registry';
import { WithdrawalsService } from './withdrawals.service';

type InitiateJob = { withdrawalId: string };
type PollJob = { withdrawalId: string; providerName: string; payoutId: string; polls: number };

const MAX_POLLS = 500;

/**
 * Payout worker: pending -> processing -> completed | failed.
 * `initiate` calls the provider registry (with failover); `poll` checks the partner status until terminal.
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

  private async initiate(job: Job<InitiateJob>) {
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
      await this.withdrawals.markFailed(w.id, `All payout providers failed: ${(err as Error).message}`);
    }
  }

  private async poll(job: Job<PollJob>) {
    const provider = this.registry.byName(job.data.providerName);
    if (!provider)
      return this.withdrawals.markFailed(
        job.data.withdrawalId,
        `Provider ${job.data.providerName} not registered`,
      );
    const status = await provider.checkStatus(job.data.payoutId);
    if (status.status === 'completed')
      return this.withdrawals.markCompleted(job.data.withdrawalId, status.raw);
    if (status.status === 'failed')
      return this.withdrawals.markFailed(
        job.data.withdrawalId,
        status.failureReason ?? 'Payout failed at provider',
        status.raw,
      );
    if (job.data.polls + 1 >= MAX_POLLS) {
      return this.withdrawals.markFailed(
        job.data.withdrawalId,
        'Payout status never became final; refunded for retry',
      );
    }
    await this.schedulePoll({ ...job.data, polls: job.data.polls + 1 });
  }

  private async schedulePoll(data: PollJob) {
    await this.queue.add('poll', data, {
      delay: this.config.env.PAYOUT_STATUS_POLL_SECONDS * 1000,
      jobId: `poll-${data.withdrawalId}-${data.polls}`,
      attempts: 5,
    });
  }
}
