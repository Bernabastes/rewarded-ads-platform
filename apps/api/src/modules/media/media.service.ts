import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { type MediaStatus, Prisma } from '@prisma/client';
import { UPLOAD_LIMITS } from '@rap/shared';
import { type Job, Queue } from 'bullmq';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppConfig } from '../../config/app-config';
import { SecurityLogger } from '../../infra/logger/logger.module';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QUEUE_MEDIA } from '../../infra/queue/queue.module';
import {
  creativesPrefixFor,
  isReadableCreativeKey,
  StorageDownloadLimitError,
  StorageService,
} from '../../infra/storage/storage.service';
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
    const advertiserId = ad.campaign.advertiserId;
    try {
      await this.fetchSource(ad, advertiserId, input, remaining());
      const probe = await this.tools.probe(input, remaining());
      const probed = Math.round(probe.durationSeconds);
      const declared = ad.durationDeclaredSeconds ?? ad.durationSeconds;
      const corrected = Math.abs(probe.durationSeconds - declared) > m.durationToleranceSeconds;

      await this.tools.transcode(input, output, m.targetHeight, remaining());
      // Output ALWAYS lands under the advertiser's own prefix, never under a client-chosen directory (#2).
      const baseKey = `${creativesPrefixFor(advertiserId)}processed/${ad.id}`;
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
      // Advertisers (and the review queue) only ever see a generic category; the raw ffmpeg/S3 detail stays in the
      // server-side security log (#2: no internal host/port/status oracle through `mediaError`).
      const detail = (err as Error).message.slice(0, 500);
      const message = publicMediaError(err);
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
      this.security.warn('media.processing_failed', { adId, advertiserId, storageKey: ad.storageKey, error: message, detail });
      return { adId, status: 'failed', error: message };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * The ONLY media source is an object in our bucket under the advertiser's own creatives prefix (or the
   * platform's seed assets). No remote URL is ever fetched (#2), the download is bounded in size and time.
   */
  private async fetchSource(
    ad: { storageKey: string | null; mediaUrl: string },
    advertiserId: string,
    target: string,
    timeoutMs: number,
  ) {
    const key = ad.storageKey ?? this.storage.storageKeyFromPublicUrl(ad.mediaUrl);
    if (!key || !isReadableCreativeKey(advertiserId, key)) {
      throw new MediaSourceError(`storage key "${key ?? ad.mediaUrl}" is outside creatives/${advertiserId}/`);
    }
    if (!(await this.storage.exists(key))) throw new MediaSourceError(`object ${key} does not exist`);
    await this.storage.downloadToFile(key, target, { maxBytes: UPLOAD_LIMITS.video.maxBytes, timeoutMs });
  }

  describeTools() {
    return this.tools.describe();
  }
}

export class MediaSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaSourceError';
  }
}

/** Safe, category-level message stored in `ads.media_error` and shown to advertisers/reviewers. */
export function publicMediaError(err: unknown): string {
  if (err instanceof MediaSourceError) return 'The creative could not be read from storage. Upload it again through the campaign wizard.';
  if (err instanceof StorageDownloadLimitError) return `The creative exceeds the ${Math.round(UPLOAD_LIMITS.video.maxBytes / 1_048_576)} MB limit.`;
  const message = err instanceof Error ? err.message : String(err);
  if (/timed out/i.test(message)) return 'Processing timed out. Try a shorter or smaller video.';
  if (/ffprobe|no duration/i.test(message)) {
    return 'The file is not a readable video (ffprobe could not determine its duration or codec).';
  }
  if (/ffmpeg/i.test(message)) return 'The video could not be transcoded to 720p H.264. Re-export it as an MP4 (H.264/AAC) and upload again.';
  if (/Invalid data|moov atom|could not find codec/i.test(message)) {
    return 'The file is not a readable video (ffprobe could not determine its duration or codec).';
  }
  return 'Media processing failed. Re-upload the creative or ask support to reprocess it.';
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