import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { secureStorage, type KeyValueStorage } from '@/utils/storage';

export interface FingerprintSources {
  /** Stable per-installation id (Android ID / iOS vendor id / persisted UUID on web). */
  installationId: string;
  platform: string;
  brand: string | null;
  modelName: string | null;
  osName: string | null;
  osVersion: string | null;
}

export interface DeviceIdentity {
  deviceId: string;
  deviceFingerprint: string;
}

const INSTALLATION_ID_KEY = 'gize.device.installationId.v1';
const FINGERPRINT_KEY = 'gize.device.fingerprint.v1';

type DigestFn = (input: string) => Promise<string>;

/** Deterministic, order-stable serialisation of the fingerprint inputs. */
export function serializeFingerprintSources(sources: FingerprintSources): string {
  return [
    sources.installationId,
    sources.platform,
    sources.brand ?? '',
    sources.modelName ?? '',
    sources.osName ?? '',
    sources.osVersion ?? '',
  ].join('|');
}

export const sha256Hex: DigestFn = (input) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input, {
    encoding: Crypto.CryptoEncoding.HEX,
  });

export async function computeFingerprint(sources: FingerprintSources, digest: DigestFn = sha256Hex): Promise<string> {
  return digest(serializeFingerprintSources(sources));
}

async function resolveInstallationId(storage: KeyValueStorage): Promise<string> {
  const persisted = await storage.getItem(INSTALLATION_ID_KEY);
  if (persisted) return persisted;

  let id: string | null = null;
  try {
    if (Platform.OS === 'android') id = Application.getAndroidId();
    else if (Platform.OS === 'ios') id = await Application.getIosIdForVendorAsync();
  } catch {
    id = null;
  }
  if (!id) id = Crypto.randomUUID();
  await storage.setItem(INSTALLATION_ID_KEY, id);
  return id;
}

export async function collectFingerprintSources(storage: KeyValueStorage = secureStorage): Promise<FingerprintSources> {
  return {
    installationId: await resolveInstallationId(storage),
    platform: Platform.OS,
    brand: Device.brand ?? null,
    modelName: Device.modelName ?? null,
    osName: Device.osName ?? null,
    osVersion: Device.osVersion ?? null,
  };
}

let identityPromise: Promise<DeviceIdentity> | null = null;

/**
 * Stable device identity sent on OTP verification, every watch session and app-install completion.
 * The fingerprint is a SHA-256 of installation id + model + OS and is persisted so it never drifts
 * for the lifetime of the installation.
 */
export function getDeviceIdentity(storage: KeyValueStorage = secureStorage): Promise<DeviceIdentity> {
  if (!identityPromise) {
    identityPromise = (async () => {
      const sources = await collectFingerprintSources(storage);
      const persisted = await storage.getItem(FINGERPRINT_KEY);
      if (persisted) return { deviceId: sources.installationId, deviceFingerprint: persisted };
      const deviceFingerprint = await computeFingerprint(sources);
      await storage.setItem(FINGERPRINT_KEY, deviceFingerprint);
      return { deviceId: sources.installationId, deviceFingerprint };
    })().catch((error) => {
      identityPromise = null;
      throw error;
    });
  }
  return identityPromise;
}

/** Test helper. */
export function resetDeviceIdentityCache() {
  identityPromise = null;
}
