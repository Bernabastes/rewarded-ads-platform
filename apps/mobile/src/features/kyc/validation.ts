import type { KycIdType, KycUploadKind } from '@rap/shared';
import { KYC_UPLOAD_LIMITS, PLATFORM_DEFAULTS } from '@rap/shared';

import type { CalendarKind, DobParts } from '@/features/auth/dob';
import { resolveDob } from '@/features/auth/dob';

export const KYC_ID_TYPES: KycIdType[] = ['fayda', 'national_id', 'passport'];

/** Which document sides a given id type needs. Passports have no back page. */
export function requiredUploads(idType: KycIdType): KycUploadKind[] {
  return idType === 'passport' ? ['document_front', 'selfie'] : ['document_front', 'document_back', 'selfie'];
}

export interface PickedFile {
  uri: string;
  mimeType: string;
  sizeBytes: number;
  fileName: string;
}

export type UploadState =
  | { status: 'empty' }
  | { status: 'uploading'; file: PickedFile }
  | { status: 'uploaded'; file: PickedFile; storageKey: string }
  | { status: 'error'; file: PickedFile | null; message: string };

export type UploadMap = Record<KycUploadKind, UploadState>;

export const EMPTY_UPLOADS: UploadMap = {
  document_front: { status: 'empty' },
  document_back: { status: 'empty' },
  selfie: { status: 'empty' },
};

export interface UploadLimits {
  maxBytes: number;
  mimeTypes: readonly string[];
}

export const DEFAULT_UPLOAD_LIMITS: UploadLimits = {
  maxBytes: KYC_UPLOAD_LIMITS.maxBytes,
  mimeTypes: KYC_UPLOAD_LIMITS.mimeTypes,
};

export type FileProblem = 'too_large' | 'type_not_allowed' | null;

/** Client-side pre-check mirroring the API's presign rules (the server still enforces them). */
export function checkFile(file: Pick<PickedFile, 'mimeType' | 'sizeBytes'>, limits: UploadLimits = DEFAULT_UPLOAD_LIMITS): FileProblem {
  if (!limits.mimeTypes.includes(file.mimeType)) return 'type_not_allowed';
  if (file.sizeBytes > limits.maxBytes) return 'too_large';
  return null;
}

export interface KycFormValues {
  idType: KycIdType;
  idNumber: string;
  fullName: string;
  calendar: CalendarKind;
  dob: DobParts;
  uploads: UploadMap;
}

export type KycFieldError = 'idNumber' | 'fullName' | 'dob' | 'dobAge' | 'documents';

export const ID_NUMBER_MIN = 6;
export const ID_NUMBER_MAX = 40;

/** Loose per-type shape check; the exact registry formats vary so we only enforce sane lengths/charsets. */
export function idNumberValid(idType: KycIdType, raw: string): boolean {
  const value = raw.trim();
  if (value.length < ID_NUMBER_MIN || value.length > ID_NUMBER_MAX) return false;
  if (idType === 'passport') return /^[A-Za-z0-9]+$/.test(value);
  return /^[A-Za-z0-9-]+$/.test(value);
}

export function validateKycForm(values: KycFormValues, now: Date = new Date()): KycFieldError[] {
  const errors: KycFieldError[] = [];
  if (!idNumberValid(values.idType, values.idNumber)) errors.push('idNumber');
  if (values.fullName.trim().length < 2) errors.push('fullName');
  const resolved = resolveDob(values.calendar, values.dob, now);
  if (!resolved) errors.push('dob');
  else if (resolved.age < PLATFORM_DEFAULTS.MIN_AGE) errors.push('dobAge');
  const missing = requiredUploads(values.idType).some((kind) => values.uploads[kind].status !== 'uploaded');
  if (missing) errors.push('documents');
  return errors;
}

export function uploadsInFlight(uploads: UploadMap): boolean {
  return Object.values(uploads).some((u) => u.status === 'uploading');
}

/** Storage keys to send in `CreateKycSubmissionDto`; null while a required upload is missing. */
export function uploadKeys(
  idType: KycIdType,
  uploads: UploadMap,
): { documentFrontKey: string; documentBackKey?: string; selfieKey: string } | null {
  const front = uploads.document_front;
  const selfie = uploads.selfie;
  const back = uploads.document_back;
  if (front.status !== 'uploaded' || selfie.status !== 'uploaded') return null;
  if (idType !== 'passport' && back.status !== 'uploaded') return null;
  return {
    documentFrontKey: front.storageKey,
    selfieKey: selfie.storageKey,
    ...(back.status === 'uploaded' ? { documentBackKey: back.storageKey } : {}),
  };
}
