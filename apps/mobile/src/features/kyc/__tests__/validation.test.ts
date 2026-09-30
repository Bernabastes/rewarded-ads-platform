import type { KycUploadKind } from '@rap/shared';

import { uploadKycFile } from '../upload';
import {
  checkFile,
  EMPTY_UPLOADS,
  idNumberValid,
  requiredUploads,
  uploadKeys,
  uploadsInFlight,
  validateKycForm,
  type KycFormValues,
  type UploadMap,
} from '../validation';

const NOW = new Date('2026-09-29T12:00:00Z');
const file = { uri: 'file:///front.jpg', mimeType: 'image/jpeg', sizeBytes: 500_000, fileName: 'front.jpg' };

function uploads(done: KycUploadKind[]): UploadMap {
  const map: UploadMap = { ...EMPTY_UPLOADS };
  for (const kind of done) map[kind] = { status: 'uploaded', file, storageKey: `private/kyc/u/${kind}.jpg` };
  return map;
}

const valid: KycFormValues = {
  idType: 'fayda',
  idNumber: '1234567890123456',
  fullName: 'Test Mobile One',
  calendar: 'ethiopian',
  dob: { day: '5', month: '13', year: '1985' },
  uploads: uploads(['document_front', 'document_back', 'selfie']),
};

describe('KYC form validation', () => {
  it('accepts a complete Fayda submission with an Ethiopian birth date', () => {
    expect(validateKycForm(valid, NOW)).toEqual([]);
  });

  it('requires front + back + selfie for cards but no back page for passports', () => {
    expect(requiredUploads('fayda')).toEqual(['document_front', 'document_back', 'selfie']);
    expect(requiredUploads('national_id')).toEqual(['document_front', 'document_back', 'selfie']);
    expect(requiredUploads('passport')).toEqual(['document_front', 'selfie']);
    expect(validateKycForm({ ...valid, uploads: uploads(['document_front', 'selfie']) }, NOW)).toEqual(['documents']);
    expect(validateKycForm({ ...valid, idType: 'passport', idNumber: 'EP1234567', uploads: uploads(['document_front', 'selfie']) }, NOW)).toEqual([]);
  });

  it('checks id number shape, name, date validity and age', () => {
    expect(validateKycForm({ ...valid, idNumber: '123' }, NOW)).toEqual(['idNumber']);
    expect(validateKycForm({ ...valid, fullName: 'A' }, NOW)).toEqual(['fullName']);
    expect(validateKycForm({ ...valid, dob: { day: '6', month: '13', year: '1985' } }, NOW)).toEqual(['dob']);
    expect(validateKycForm({ ...valid, calendar: 'gregorian', dob: { day: '1', month: '1', year: '2010' } }, NOW)).toEqual(['dobAge']);
    expect(idNumberValid('passport', 'EP-123456')).toBe(false);
    expect(idNumberValid('national_id', 'AA-12-3456')).toBe(true);
  });

  it('mirrors the API upload limits client-side', () => {
    expect(checkFile(file)).toBeNull();
    expect(checkFile({ mimeType: 'image/gif', sizeBytes: 10 })).toBe('type_not_allowed');
    expect(checkFile({ mimeType: 'image/png', sizeBytes: 9 * 1024 * 1024 })).toBe('too_large');
    expect(checkFile({ mimeType: 'application/pdf', sizeBytes: 10 }, { maxBytes: 5, mimeTypes: ['application/pdf'] })).toBe('too_large');
  });

  it('builds the storage-key payload only once every required upload finished', () => {
    expect(uploadKeys('fayda', uploads(['document_front', 'selfie']))).toBeNull();
    expect(uploadKeys('passport', uploads(['document_front', 'selfie']))).toEqual({
      documentFrontKey: 'private/kyc/u/document_front.jpg',
      selfieKey: 'private/kyc/u/selfie.jpg',
    });
    expect(uploadKeys('fayda', valid.uploads)).toMatchObject({ documentBackKey: 'private/kyc/u/document_back.jpg' });
    const inFlight: UploadMap = { ...EMPTY_UPLOADS, selfie: { status: 'uploading', file } };
    expect(uploadsInFlight(inFlight)).toBe(true);
    expect(uploadsInFlight(EMPTY_UPLOADS)).toBe(false);
  });
});

describe('uploadKycFile', () => {
  it('presigns, PUTs the bytes with the returned headers and resolves with the storage key', async () => {
    const presign = jest.fn(async () => ({
      method: 'PUT' as const,
      uploadUrl: 'http://minio.test/private/kyc/u/front.jpg?sig=1',
      headers: { 'Content-Type': 'image/jpeg' },
      storageKey: 'private/kyc/u/front.jpg',
      publicUrl: '',
      expiresInSeconds: 900,
      kind: 'document_front',
    }));
    const blob = new Blob(['bytes'], { type: 'image/jpeg' });
    const fetchFn = jest.fn(async () => new Response(null, { status: 200 }));
    const key = await uploadKycFile('document_front', file, { presign, fetchFn: fetchFn as never, readBlob: async () => blob });

    expect(key).toBe('private/kyc/u/front.jpg');
    expect(presign).toHaveBeenCalledWith({ kind: 'document_front', contentType: 'image/jpeg', sizeBytes: blob.size });
    const [url, init] = (fetchFn as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('sig=1');
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('image/jpeg');
    expect(init.body).toBe(blob);
  });

  it('fails loudly when the object store rejects the PUT', async () => {
    const presign = jest.fn(async () => ({
      method: 'PUT' as const,
      uploadUrl: 'http://minio.test/x',
      headers: {},
      storageKey: 'k',
      publicUrl: '',
      expiresInSeconds: 900,
      kind: 'selfie',
    }));
    const fetchFn = jest.fn(async () => new Response('denied', { status: 403 }));
    await expect(
      uploadKycFile('selfie', file, { presign, fetchFn: fetchFn as never, readBlob: async () => new Blob(['x']) }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
