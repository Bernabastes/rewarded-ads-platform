import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Global, Injectable, Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppConfig } from '../../config/app-config';

export interface PresignedUpload {
  method: 'PUT';
  uploadUrl: string;
  headers: Record<string, string>;
  storageKey: string;
  publicUrl: string;
  expiresInSeconds: number;
}

/** Prefix of objects that must never be served publicly (KYC documents, data exports); read via presigned GET only. */
export const PRIVATE_PREFIX = 'private';
/** Advertiser creatives live under `creatives/<advertiserId>/...` (presigned uploads + processed renditions). */
export const CREATIVES_PREFIX = 'creatives';
/** Platform-owned demo media written by the seed; readable by the media worker like a creative. */
export const SEED_PREFIX = 'seed';

const SAFE_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/]*$/;

/** True when `storageKey` is a well-formed key (no traversal, no empty segments, no leading slash). */
export function isWellFormedStorageKey(storageKey: string): boolean {
  if (!storageKey || storageKey.length > 300 || !SAFE_KEY_RE.test(storageKey)) return false;
  const segments = storageKey.split('/');
  return segments.every((s) => s.length > 0 && s !== '.' && s !== '..');
}

/** The only prefix an advertiser may reference for its own creatives (security audit #2). */
export function creativesPrefixFor(advertiserId: string): string {
  return `${CREATIVES_PREFIX}/${advertiserId}/`;
}

export function isCreativeKeyOf(advertiserId: string, storageKey: string): boolean {
  return isWellFormedStorageKey(storageKey) && storageKey.startsWith(creativesPrefixFor(advertiserId));
}

/** Keys the media worker is allowed to READ: the advertiser's own creatives or the platform's seed assets. */
export function isReadableCreativeKey(advertiserId: string, storageKey: string): boolean {
  return isCreativeKeyOf(advertiserId, storageKey) || (isWellFormedStorageKey(storageKey) && storageKey.startsWith(`${SEED_PREFIX}/`));
}

export class StorageDownloadLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageDownloadLimitError';
  }
}

/**
 * S3-compatible object storage (MinIO locally, AWS S3 / any S3 API in production).
 * Uploads happen browser -> storage via presigned PUT URLs; the API never proxies media bytes.
 * Two clients: `client` talks to the internal endpoint for server-side calls; `presignClient` targets the
 * browser-reachable S3_PUBLIC_ENDPOINT because the host name is part of a SigV4 signature.
 */
@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly presignClient: S3Client;

  constructor(private readonly config: AppConfig) {
    const e = config.env;
    const base = {
      region: e.S3_REGION,
      forcePathStyle: e.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: e.S3_ACCESS_KEY, secretAccessKey: e.S3_SECRET_KEY },
    };
    this.client = new S3Client({ ...base, endpoint: e.S3_ENDPOINT });
    this.presignClient = new S3Client({ ...base, endpoint: this.publicEndpoint });
  }

  /** Endpoint embedded in presigned URLs (falls back to S3_PUBLIC_URL, then the internal endpoint). */
  get publicEndpoint(): string {
    const e = this.config.env;
    return (e.S3_PUBLIC_ENDPOINT || e.S3_PUBLIC_URL || e.S3_ENDPOINT).replace(/\/$/, '');
  }

  get bucket(): string {
    return this.config.env.S3_BUCKET;
  }

  buildKey(prefix: string, fileName: string): string {
    const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')).toLowerCase() : '';
    const safeExt = /^\.[a-z0-9]{1,5}$/.test(ext) ? ext : '';
    return `${prefix}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${safeExt}`;
  }

  isPrivateKey(storageKey: string): boolean {
    return storageKey.startsWith(`${PRIVATE_PREFIX}/`);
  }

  publicUrl(storageKey: string): string {
    const base = this.config.env.S3_PUBLIC_URL.replace(/\/$/, '');
    return `${base}/${this.config.env.S3_BUCKET}/${storageKey}`;
  }

  /**
   * Inverse of `publicUrl`: the storage key when `url` points INTO our own bucket on the public endpoint, else
   * null. Strict origin + bucket comparison (no host look-alikes, no other buckets) - the only way a URL may become
   * a media source (security audit #2: no remote fetches).
   */
  storageKeyFromPublicUrl(url: string): string | null {
    let parsed: URL;
    let base: URL;
    try {
      parsed = new URL(url);
      base = new URL(this.config.env.S3_PUBLIC_URL);
    } catch {
      return null;
    }
    if (parsed.origin !== base.origin || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) return null;
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    const basePath = base.pathname.replace(/\/$/, '');
    const prefix = `${basePath}/${this.config.env.S3_BUCKET}/`;
    if (!parsed.pathname.startsWith(prefix)) return null;
    let key: string;
    try {
      key = decodeURIComponent(parsed.pathname.slice(prefix.length));
    } catch {
      return null;
    }
    return isWellFormedStorageKey(key) ? key : null;
  }

  async presignUpload(storageKey: string, contentType: string, sizeBytes: number): Promise<PresignedUpload> {
    const expiresIn = this.config.env.S3_PRESIGN_TTL_SECONDS;
    const command = new PutObjectCommand({
      Bucket: this.config.env.S3_BUCKET,
      Key: storageKey,
      ContentType: contentType,
      ContentLength: sizeBytes,
    });
    const uploadUrl = await getSignedUrl(this.presignClient, command, { expiresIn });
    return {
      method: 'PUT',
      uploadUrl,
      headers: { 'Content-Type': contentType },
      storageKey,
      publicUrl: this.isPrivateKey(storageKey) ? '' : this.publicUrl(storageKey),
      expiresInSeconds: expiresIn,
    };
  }

  /** Short-lived presigned GET for private objects (KYC documents, data exports). */
  async presignDownload(storageKey: string, expiresIn: number): Promise<{ url: string; expiresInSeconds: number }> {
    const command = new GetObjectCommand({ Bucket: this.config.env.S3_BUCKET, Key: storageKey });
    const url = await getSignedUrl(this.presignClient, command, { expiresIn });
    return { url, expiresInSeconds: expiresIn };
  }

  async upload(storageKey: string, body: Buffer | Uint8Array | string, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.env.S3_BUCKET,
        Key: storageKey,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  /**
   * Downloads an object to a local file. `maxBytes` aborts the transfer once exceeded (the worker must never spool
   * an unbounded object to disk) and `timeoutMs` bounds the whole transfer.
   */
  async downloadToFile(
    storageKey: string,
    filePath: string,
    limits: { maxBytes?: number; timeoutMs?: number } = {},
  ): Promise<void> {
    const controller = new AbortController();
    const timer = limits.timeoutMs ? setTimeout(() => controller.abort(), limits.timeoutMs) : undefined;
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.env.S3_BUCKET, Key: storageKey }),
        { abortSignal: controller.signal },
      );
      if (!res.Body) throw new Error(`Object ${storageKey} has no body`);
      if (limits.maxBytes !== undefined && (res.ContentLength ?? 0) > limits.maxBytes) {
        throw new StorageDownloadLimitError(`Object ${storageKey} is larger than ${limits.maxBytes} bytes`);
      }
      let received = 0;
      const max = limits.maxBytes;
      const guard = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          received += chunk.length;
          if (max !== undefined && received > max) {
            cb(new StorageDownloadLimitError(`Object ${storageKey} exceeded ${max} bytes while downloading`));
            return;
          }
          cb(null, chunk);
        },
      });
      await pipeline(res.Body as Readable, guard, createWriteStream(filePath), { signal: controller.signal });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.config.env.S3_BUCKET, Key: storageKey }));
      return true;
    } catch {
      return false;
    }
  }

  async delete(storageKey: string): Promise<void> {
    await this.client
      .send(new DeleteObjectCommand({ Bucket: this.config.env.S3_BUCKET, Key: storageKey }))
      .catch(() => undefined);
  }
}

@Global()
@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
