import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { type MediaStatus, Prisma } from '@prisma/client';
import { type Job, Queue } from 'bullmq';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppConfig } from '../../config/app-config';
import { SecurityLogger } from '../../infra/logger/logger.module';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QUEUE_MEDIA } from '../../infra/queue/queue.module';
import { StorageService } from '../../infra/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { MEDIA_TOOLS, type MediaTools, type ProbeResult } from './ffmpeg.tools';

export interface MediaProcessOutcome {
  adId: string;
  status: MediaStatus;
  probe?: ProbeResult;
  durationCorrected?: { declared: number; probed: number };
  transcodedKey?: string;
  posterKey?: string;
  error?: string;
}

/**
 * Creative processing pipeline (`media.process` job): download the upload, ffprobe it (true duration, codec,
 * dimensions), correct the advertiser-declared duration when it is off by more than the tolerance, transcode to a
 * 720p H.264 MP4 that becomes the served `media_url`, and generate a poster when no thumbnail was supplied.
 * Time-boxed by MEDIA_JOB_TIMEOUT_SECONDS. Review cannot approve while `processing`/`failed`.
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly security: SecurityLogger,
    @Inject(MEDIA_TOOLS) private readonly tools: MediaTools,
    @InjectQueue(QUEUE_MEDIA) private readonly queue: Queue,
  ) {}

  /** Pipeline is skipped (ads are created `ready`) when disabled or in tests. */
  isEnabled(): boolean {
    return this.config.media.enabled && !this.config.isTest;
  }

  async enqueue(adId: string, reason: 'created' | 'reprocess' = 'created') {
    if (!this.config.env.QUEUES_ENABLED && reason === 'created') {
      // API-only instance: a worker deployment (same image, QUEUES_ENABLED=true) picks the job up.
    }
    try {
      await this.queue.add(
        'process',
        { adId, reason },
        { jobId: `media-${adId}-${Date.now()}`, attempts: 2, backoff: { type: 'fixed', delay: 15_000 } },
      );
    } catch (err) {
      this.logger.error(`Could not enqueue media.process for ad ${adId}: ${(err as Error).message}`);
    }
  }

  /** Admin re-run (e.g. after a failure or a fixed upload). Resets the ad to `processing`. */
  async reprocess(adId: string, actor: { adminId: string; ip?: string }) {
    const ad = await this.prisma.ad.findUnique({ where: { id: adId } });
    if (!ad) throw new Error('Ad not found');
    await this.prisma.ad.update({
      where: { id: adId },
      data: { mediaStatus: 'processing', mediaError: null },
    });
    await this.audit.record({
      actorType: 'admin',
      actorId: actor.adminId,
      action: 'ad.media_reprocess_requested',
      targetType: 'ad',
      targetId: adId,
      before: { mediaStatus: ad.mediaStatus, mediaError: ad.mediaError },
      after: { mediaStatus: 'processing' },
      ipAddress: actor.ip,
    });
    await this.enqueue(adId, 'reprocess');
    return this.prisma.ad.findUniqueOrThrow({ where: { id: adId } });
  }

  async process(adId: string): Promise<MediaProcessOutcome> {
    const ad = await this.prisma.ad.findUnique({ where: { id: adId }, include: { campaign: true } });
    if (!ad) return { adId, status: 'failed', error: 'Ad not found' };
    if (ad.mediaType !== 'video') {
      await this.prisma.ad.update({
        where: { id: adId },
        data: { mediaStatus: 'ready', mediaProcessedAt: new Date(), mediaError: null },
      });
      return { adId, status: 'ready' };
    }

    const m = this.config.media;
    const timeoutMs = m.jobTimeoutSeconds * 1000;
    const deadline = Date.now() + timeoutMs;
    const remaining = () => Math.max(5_000, deadline - Date.now());
    const workDir = await mkdtemp(join(tmpdir(), 'rap-media-'));
    const input = join(workDir, 'input');
    const output = join(workDir, 'transcoded.mp4');
    const poster = join(workDir, 'poster.png');
    try {
      await this.fetchSource(ad, input);
      const probe = await this.tools.probe(input, remaining());
      const probed = Math.round(probe.durationSeconds);
      const declared = ad.durationDeclaredSeconds ?? ad.durationSeconds;
      const corrected = Math.abs(probe.durationSeconds - declared) > m.durationToleranceSeconds;

      await this.tools.transcode(input, output, m.targetHeight, remaining());
      const baseKey = this.processedKeyPrefix(ad.storageKey, ad.campaign.advertiserId, ad.id);
      const transcodedKey = `${baseKey}/transcoded.mp4`;
      await this.storage.upload(transcodedKey, await readFile(output), 'video/mp4');

      let posterKey: string | undefined;
      if (!ad.thumbnailUrl) {
        try {
          await this.tools.poster(input, poster, remaining());
          posterKey = `${baseKey}/poster.png`;
          await this.storage.upload(posterKey, await readFile(poster), 'image/png');
        } catch (err) {
          this.logger.warn(`Poster generation failed for ad ${adId}: ${(err as Error).message}`);
          posterKey = undefined;
        }
      }

      const status: MediaStatus = corrected ? 'duration_corrected' : 'ready';
      await this.prisma.$transaction(async (tx) => {
        await tx.ad.update({
          where: { id: adId },
          data: {
            mediaStatus: status,
            mediaProbe: probe as unknown as Prisma.InputJsonValue,
            durationDeclaredSeconds: declared,
            durationProbedSeconds: probed,
            durationSeconds: corrected ? Math.max(1, probed) : ad.durationSeconds,
            originalMediaUrl: ad.originalMediaUrl ?? ad.mediaUrl,
            transcodedStorageKey: transcodedKey,
            mediaUrl: this.storage.publicUrl(transcodedKey),
            thumbnailUrl: posterKey ? this.storage.publicUrl(posterKey) : ad.thumbnailUrl,
            mediaError: null,
            mediaProcessedAt: new Date(),
          },
        });
        await this.audit.record(
          {
            actorType: 'system',
            action: corrected ? 'ad.media_processed_duration_corrected' : 'ad.media_processed',
            targetType: 'ad',
            targetId: adId,
            before: { mediaStatus: ad.mediaStatus, durationSeconds: ad.durationSeconds },
            after: { mediaStatus: status, durationSeconds: corrected ? probed : ad.durationSeconds, probe },
          },
          tx,
        );
      });
      if (corrected) {
        this.security.warn('media.duration_corrected', {
          adId,
          campaignId: ad.campaignId,
          declared,
          probed: probe.durationSeconds,
        });
      }
      this.logger.log(`Media processed for ad ${adId}: ${status} (${probe.width}x${probe.height}, ${probed}s)`);
      return {
        adId,
        status,
        probe,
        transcodedKey,
        posterKey,
        ...(corrected ? { durationCorrected: { declared, probed } } : {}),
      };
    } catch (err) {
      const message = (err as Error).message.slice(0, 500);
      await this.prisma.ad.update({
        where: { id: adId },
        data: { mediaStatus: 'failed', mediaError: message, mediaProcessedAt: new Date() },
      });
      await this.audit.record({
        actorType: 'system',
        action: 'ad.media_failed',
        targetType: 'ad',
        targetId: adId,
        after: { error: message },
      });
      this.security.warn('media.processing_failed', { adId, error: message });
      return { adId, status: 'failed', error: message };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async fetchSource(ad: { storageKey: string | null; mediaUrl: string }, target: string) {
    if (ad.storageKey && (await this.storage.exists(ad.storageKey))) {
      await this.storage.downloadToFile(ad.storageKey, target);
      return;
    }
    const res = await fetch(ad.mediaUrl);
    if (!res.ok) throw new Error(`Could not download media (${res.status})`);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(target, Buffer.from(await res.arrayBuffer()));
  }

  private processedKeyPrefix(storageKey: string | null, advertiserId: string, adId: string): string {
    const dir = storageKey?.includes('/') ? storageKey.slice(0, storageKey.lastIndexOf('/')) : null;
    return `${dir ?? `creatives/${advertiserId}`}/processed/${adId}`;
  }

  describeTools() {
    return this.tools.describe();
  }
}

@Processor(QUEUE_MEDIA, { concurrency: 1 })
export class MediaProcessor extends WorkerHost {
  constructor(private readonly media: MediaService) {
    super();
  }

  async process(job: Job<{ adId: string }>) {
    return this.media.process(job.data.adId);
  }
}