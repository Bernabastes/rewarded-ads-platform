import type { KycUploadKind } from '@rap/shared';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import { usersApi } from '@/api/endpoints/users';
import { ApiError, ClientErrorCode } from '@/api/errors';

import type { PickedFile } from './validation';

export type PickSource = 'camera' | 'library';

/** The camera only exists on devices; web gets the file chooser through the library picker. */
export function cameraAvailable(): boolean {
  return Platform.OS !== 'web';
}

function guessMime(uri: string, fileName: string | null | undefined, declared: string | undefined): string {
  if (declared) return declared;
  const name = (fileName ?? uri).toLowerCase();
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.pdf')) return 'application/pdf';
  return 'image/jpeg';
}

/**
 * Opens the camera or the gallery / file chooser and returns one image (null when cancelled).
 * `expo-image-picker` renders an `<input type="file">` on web, so the same code path works everywhere.
 */
export async function pickKycImage(source: PickSource): Promise<PickedFile | null> {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.85, allowsEditing: false };
  let result: ImagePicker.ImagePickerResult;
  if (source === 'camera' && cameraAvailable()) {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new ApiError(0, ClientErrorCode.UNKNOWN, 'camera permission denied', { permission: 'camera' });
    result = await ImagePicker.launchCameraAsync(options);
  } else {
    if (Platform.OS !== 'web') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw new ApiError(0, ClientErrorCode.UNKNOWN, 'library permission denied', { permission: 'library' });
    }
    result = await ImagePicker.launchImageLibraryAsync(options);
  }
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  const mimeType = guessMime(asset.uri, asset.fileName, asset.mimeType);
  let sizeBytes = asset.fileSize ?? 0;
  if (!sizeBytes) sizeBytes = (await readBlob(asset.uri)).size;
  const extension = mimeType.split('/')[1] ?? 'jpg';
  return { uri: asset.uri, mimeType, sizeBytes, fileName: asset.fileName ?? `${source}.${extension}` };
}

/** `fetch` turns file:// (native) and data:/blob: (web) URIs into a Blob we can PUT as-is. */
async function readBlob(uri: string): Promise<Blob> {
  const response = await fetch(uri);
  return response.blob();
}

export interface UploadDeps {
  presign?: typeof usersApi.kycPresign;
  fetchFn?: typeof fetch;
  readBlob?: (uri: string) => Promise<Blob>;
}

/**
 * Presigned PUT into the private KYC prefix: `POST /users/me/kyc/uploads/presign` → PUT the bytes with
 * the returned headers → the `storageKey` goes into the submission. Nothing is ever public.
 */
export async function uploadKycFile(kind: KycUploadKind, file: PickedFile, deps: UploadDeps = {}): Promise<string> {
  const presign = deps.presign ?? usersApi.kycPresign;
  const fetchFn = deps.fetchFn ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const blob = await (deps.readBlob ?? readBlob)(file.uri);
  const sizeBytes = blob.size || file.sizeBytes;
  const ticket = await presign({ kind, contentType: file.mimeType, sizeBytes });
  const response = await fetchFn(ticket.uploadUrl, {
    method: ticket.method ?? 'PUT',
    headers: { 'Content-Type': file.mimeType, ...ticket.headers },
    body: blob,
  });
  if (!response.ok) {
    throw new ApiError(response.status, ClientErrorCode.UNKNOWN, `Upload failed with HTTP ${response.status}`);
  }
  return ticket.storageKey;
}
