import type { PayoutDestinationItem } from '@rap/shared';

import { kvStorage, type KeyValueStorage } from '@/utils/storage';

import { matchesMask, type RememberedDestination } from './destinationFlow';

const STORAGE_KEY = 'gize.wallet.destinations.v1';
const MAX_REMEMBERED = 10;

/**
 * The API only returns MASKED known destinations (`+2519****0137`) and `POST /withdrawals` needs the
 * full number, so the device keeps the destinations it successfully submitted. A `knownDestinations`
 * chip becomes a one-tap choice when the device remembers its full number; otherwise the chip asks
 * the user to type the number (the partner lookup then answers `known: true` and no OTP is needed).
 */
export async function loadRememberedDestinations(storage: KeyValueStorage = kvStorage): Promise<RememberedDestination[]> {
  try {
    const raw = await storage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed)
      ? parsed.filter(
          (d): d is RememberedDestination =>
            typeof d === 'object' && d !== null && typeof (d as RememberedDestination).destination === 'string',
        )
      : [];
  } catch {
    return [];
  }
}

export async function rememberDestination(
  item: RememberedDestination,
  storage: KeyValueStorage = kvStorage,
): Promise<RememberedDestination[]> {
  const existing = await loadRememberedDestinations(storage);
  const next = [
    item,
    ...existing.filter((d) => !(d.payoutMethod === item.payoutMethod && d.destination === item.destination)),
  ].slice(0, MAX_REMEMBERED);
  try {
    await storage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode - ignore */
  }
  return next;
}

export interface KnownChip {
  server: PayoutDestinationItem;
  /** Full number when this device remembers it (one tap, no lookup/OTP). */
  remembered: RememberedDestination | null;
}

/** Pairs the server's masked known destinations for a method with what this device remembers. */
export function knownChipsFor(
  known: PayoutDestinationItem[],
  remembered: RememberedDestination[],
  method: string,
): KnownChip[] {
  return known
    .filter((k) => k.payoutMethod === method && k.known)
    .map((server) => ({
      server,
      remembered:
        remembered.find((r) => r.payoutMethod === server.payoutMethod && matchesMask(r.destination, server.destination)) ??
        null,
    }));
}
