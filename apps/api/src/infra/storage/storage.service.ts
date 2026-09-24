import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Global, Injectable, Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppConfig } from '../../config/app-config';

export interface PresignedUpload {
  method: 'PUT';
  uploadUrl: string;
  headers: Record<string, string>;
  storageKey: string;
  publicUrl: string;
  expiresInSeconds: number;
}

/**
 * S3-compatible object storage (MinIO locally, AWS S3 / any S3 API in production).
 * Uploads happen browser -> storage via presigned PUT URLs; the API never proxies media bytes.
 */
@Injectable()
export class StorageService {
  private readonly client: S3Client;

  constructor(private readonly config: AppConfig) {
    const e = config.env;
    this.client = new S3Client({
      region: e.S3_REGION,
      endpoint: e.S3_ENDPOINT,
      forcePathStyle: e.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: e.S3_ACCESS_KEY, secretAccessKey: e.S3_SECRET_KEY },
    });
  }

  buildKey(prefix: string, fileName: string): string {
    const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')).toLowerCase() : '';
    const safeExt = /^\.[a-z0-9]{1,5}$/.test(ext) ? ext : '';
    return `${prefix}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${safeExt}`;
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
    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn });
    return {
      method: 'PUT',
      uploadUrl,
      headers: { 'Content-Type': contentType },
      storageKey,
      publicUrl: this.publicUrl(storageKey),
      expiresInSeconds: expiresIn,
    };
  }
}

@Global()
@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
