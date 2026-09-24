import type { MediaType, PresignUploadResponse } from '@rap/shared';
import { env } from '@/config/env';
import { validateCreativeFile } from '@/lib/utils/media';
import { campaignsApi } from './index';
import { ApiError, ClientErrorCode } from './errors';

export interface UploadProgress {
  loaded: number;
  total: number;
  /** 0..1 */
  ratio: number;
}

export interface UploadedCreative {
  storageKey: string;
  publicUrl: string;
  mediaType: MediaType;
  presign: PresignUploadResponse;
}

/**
 * Presigned URLs may be signed for a host the browser cannot reach (Docker-internal `minio:9000`). Rewrite
 * those to the dev-server proxy path which forwards the request with the original Host header intact.
 */
export function resolveUploadUrl(
  uploadUrl: string,
  internalOrigin: string = env.uploadInternalOrigin,
  proxyPath: string = env.uploadProxyPath,
): string {
  if (!internalOrigin) return uploadUrl;
  const normalizedOrigin = internalOrigin.replace(/\/+$/, '');
  if (!uploadUrl.startsWith(`${normalizedOrigin}/`)) return uploadUrl;
  return `${proxyPath}${uploadUrl.slice(normalizedOrigin.length)}`;
}

function putWithProgress(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress?: (progress: UploadProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    for (const [key, value] of Object.entries(headers)) {
      // The browser owns Content-Length / Host; everything else from the presign response is forwarded.
      if (/^(content-length|host)$/i.test(key)) continue;
      xhr.setRequestHeader(key, value);
    }
    xhr.upload.onprogress = (event) => {
      if (!onProgress) return;
      const total = event.lengthComputable ? event.total : file.size;
      onProgress({ loaded: event.loaded, total, ratio: total ? Math.min(1, event.loaded / total) : 0 });
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.({ loaded: file.size, total: file.size, ratio: 1 });
        resolve();
      } else {
        reject(
          new ApiError({
            statusCode: xhr.status,
            code: ClientErrorCode.UPLOAD_FAILED,
            message: `Storage rejected the upload (${xhr.status})`,
          }),
        );
      }
    };
    xhr.onerror = () =>
      reject(
        new ApiError({
          statusCode: 0,
          code: ClientErrorCode.UPLOAD_FAILED,
          message: 'Network error while uploading the file',
        }),
      );
    xhr.onabort = () => reject(new DOMException('Upload aborted', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

/** presign → PUT (with progress) → return the storage key to register the ad with. */
export async function uploadCreative(
  file: File,
  options: { onProgress?: (progress: UploadProgress) => void; signal?: AbortSignal } = {},
): Promise<UploadedCreative> {
  const validation = validateCreativeFile(file);
  if (!validation.ok || !validation.mediaType) {
    throw new ApiError({
      statusCode: 0,
      code: ClientErrorCode.UPLOAD_FAILED,
      message: validation.reason ?? 'Unsupported file',
    });
  }
  const presign = await campaignsApi.presign({
    fileName: file.name,
    contentType: file.type,
    sizeBytes: file.size,
  });
  await putWithProgress(
    resolveUploadUrl(presign.uploadUrl),
    file,
    presign.headers,
    options.onProgress,
    options.signal,
  );
  return {
    storageKey: presign.storageKey,
    publicUrl: presign.publicUrl,
    mediaType: validation.mediaType,
    presign,
  };
}
