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
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
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

  async downloadToFile(storageKey: string, filePath: string): Promise<void> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.env.S3_BUCKET, Key: storageKey }),
    );
    if (!res.Body) throw new Error(`Object ${storageKey} has no body`);
    await pipeline(res.Body as Readable, createWriteStream(filePath));
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
