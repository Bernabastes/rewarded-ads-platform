import { Platform } from 'react-native';

import { createMemoryStorage } from '@/utils/storage';

import {
  collectFingerprintSources,
  computeFingerprint,
  getDeviceIdentity,
  resetDeviceIdentityCache,
  serializeFingerprintSources,
  type FingerprintSources,
} from '../fingerprint';

const sources: FingerprintSources = {
  installationId: 'install-1',
  platform: 'android',
  brand: 'TestBrand',
  modelName: 'Pixel 4a',
  osName: 'Android',
  osVersion: '13',
};

describe('device fingerprint', () => {
  beforeEach(() => resetDeviceIdentityCache());

  it('serialises the sources in a stable order', () => {
    expect(serializeFingerprintSources(sources)).toBe('install-1|android|TestBrand|Pixel 4a|Android|13');
    expect(serializeFingerprintSources({ ...sources, brand: null, osVersion: null })).toBe('install-1|android||Pixel 4a|Android|');
  });

  it('produces the same hash for the same inputs and a different one when a source changes', async () => {
    const digest = async (input: string) => `sha(${input})`;
    const a = await computeFingerprint(sources, digest);
    const b = await computeFingerprint({ ...sources }, digest);
    const c = await computeFingerprint({ ...sources, osVersion: '14' }, digest);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('uses the platform installation id (Android id / iOS vendor id) and persists it', async () => {
    const expectedId = Platform.OS === 'android' ? 'android-id-123' : 'ios-vendor-id';
    const storage = createMemoryStorage();
    const first = await collectFingerprintSources(storage);
    const second = await collectFingerprintSources(storage);
    expect(first.installationId).toBe(expectedId);
    expect(second.installationId).toBe(first.installationId);
    expect(await storage.getItem('gize.device.installationId.v1')).toBe(expectedId);
  });

  it('returns a stable identity across calls and across app restarts (same storage)', async () => {
    const storage = createMemoryStorage();
    const identity = await getDeviceIdentity(storage);
    const again = await getDeviceIdentity(storage);
    expect(again).toEqual(identity);
    expect(identity.deviceFingerprint).toMatch(/^[0-9a-f]{64}$/);

    resetDeviceIdentityCache();
    const afterRestart = await getDeviceIdentity(storage);
    expect(afterRestart).toEqual(identity);
  });

  it('keeps the persisted fingerprint even if device details change later', async () => {
    const storage = createMemoryStorage({
      'gize.device.installationId.v1': 'install-1',
      'gize.device.fingerprint.v1': 'persisted-fingerprint',
    });
    const identity = await getDeviceIdentity(storage);
    expect(identity).toEqual({ deviceId: 'install-1', deviceFingerprint: 'persisted-fingerprint' });
  });
});
