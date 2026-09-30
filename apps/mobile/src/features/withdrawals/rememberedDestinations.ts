import type { PayoutDestinationItem } from '@rap/shared';

import { kvStorage, type KeyValueStorage } from '@/utils/storage';

import { matchesMask, type RememberedDestination } from './destinationFlow';

const STORAGE_KEY = 'gize.wallet.destinations.v1';
const MAX_REMEMBERED = 10;

/**
 * Known destinations from the API are MASKED (`+2519****0137`) and carry a server `id`; since Phase 4C a known chip
 * is sent as `payoutDestinationId` and the server resolves the number, so nothing needs to be stored on-device.
 * The device still remembers the destinations it submitted so the summary can show the full number (display
 * only) and so older API versions keep working.
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
