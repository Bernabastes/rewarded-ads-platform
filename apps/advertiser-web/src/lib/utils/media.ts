import { UPLOAD_LIMITS, type MediaType } from '@rap/shared';

export type CreativeKind = MediaType;

export function detectMediaType(mimeType: string): CreativeKind | null {
  if ((UPLOAD_LIMITS.video.mimeTypes as readonly string[]).includes(mimeType)) return 'video';
  if ((UPLOAD_LIMITS.image.mimeTypes as readonly string[]).includes(mimeType)) return 'image';
  return null;
}

export interface CreativeValidation {
  ok: boolean;
  mediaType: CreativeKind | null;
  reason?: string;
}

export function validateCreativeFile(file: File): CreativeValidation {
  const mediaType = detectMediaType(file.type);
  if (!mediaType) {
    return {
      ok: false,
      mediaType: null,
      reason: 'Unsupported file type. Upload an MP4/WebM video or a JPEG/PNG/WebP image.',
    };
  }
  const limit = UPLOAD_LIMITS[mediaType];
  if (file.size > limit.maxBytes) {
    const maxMb = Math.round(limit.maxBytes / (1024 * 1024));
    return {
      ok: false,
      mediaType,
      reason: `File is too large. ${mediaType === 'video' ? 'Videos' : 'Images'} must be under ${maxMb} MB.`,
    };
  }
  return { ok: true, mediaType };
}

/** Read the duration of a video file client-side (seconds, rounded). */
export function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      video.load();
    };
    video.onloadedmetadata = () => {
      const duration = video.duration;
      cleanup();
      if (!Number.isFinite(duration) || duration <= 0) {
        reject(new Error('Could not read the video duration.'));
        return;
      }
      resolve(Math.round(duration));
    };
    video.onerror = () => {
      cleanup();
      reject(new Error('This video could not be decoded by your browser.'));
    };
    video.src = url;
  });
}

export function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This image could not be decoded by your browser.'));
    };
    image.src = url;
  });
}
