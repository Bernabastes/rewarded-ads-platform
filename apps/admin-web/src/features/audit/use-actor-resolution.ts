import { ETHIOPIAN_PHONE_REGEX } from '@rap/shared';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { auditApi, usersApi } from '@/lib/api/endpoints';
import { queryKeys } from '@/lib/api/query-keys';
import { useAuth } from '@/lib/auth/use-auth';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ActorInputKind = 'empty' | 'uuid' | 'email' | 'phone' | 'unknown';

/** Classify what the admin typed into the Actor box. */
export function classifyActorInput(raw: string): { kind: ActorInputKind; value: string } {
  const value = raw.trim();
  if (!value) return { kind: 'empty', value };
  if (UUID_RE.test(value)) return { kind: 'uuid', value: value.toLowerCase() };
  if (EMAIL_RE.test(value)) return { kind: 'email', value: value.toLowerCase() };
  const phone = normalizePhone(value);
  if (phone) return { kind: 'phone', value: phone };
  return { kind: 'unknown', value };
}

/** "0911 001 233" / "251911001233" / "+251911001233" → "+251911001233" (null when not an Ethiopian mobile number). */
export function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/[\s()-]/g, '');
  if (/^251[79]\d{8}$/.test(digits)) digits = `+${digits}`;
  if (!ETHIOPIAN_PHONE_REGEX.test(digits)) return null;
  return digits.startsWith('0') ? `+251${digits.slice(1)}` : digits;
}

export type ActorResolution =
  | { status: 'idle' }
  | { status: 'invalid'; message: string }
  | { status: 'resolving' }
  | { status: 'resolved'; id: string; label: string; kind: 'admin' | 'user' | 'unknown' }
  | { status: 'not_found'; message: string };

/**
 * Turn an admin email / user phone / raw id into an `actorId` for the audit-log filter.
 *  - uuid  → used as-is;
 *  - email → the API has no admin directory; admin actors are matched against the `actorEmail` of recent
 *            admin audit rows (plus the signed-in admin itself);
 *  - phone → `GET /admin/users?q=` and an exact match on the phone number.
 */
export function useResolveActor(raw: string): ActorResolution {
  const { admin, can } = useAuth();
  const input = useMemo(() => classifyActorInput(raw), [raw]);

  const adminRows = useQuery({
    queryKey: queryKeys.audit({ actorType: 'admin', limit: 100, directory: true }),
    queryFn: () => auditApi.list({ actorType: 'admin', limit: 100 }),
    enabled: input.kind === 'email' && input.value !== admin?.email.toLowerCase(),
    staleTime: 5 * 60_000,
  });
  const users = useQuery({
    queryKey: queryKeys.users({ q: input.value, limit: 5, resolve: true }),
    queryFn: () => usersApi.list({ q: input.value, limit: 5 }),
    enabled: input.kind === 'phone' && can('users'),
    staleTime: 5 * 60_000,
  });

  return useMemo<ActorResolution>(() => {
    switch (input.kind) {
      case 'empty':
        return { status: 'idle' };
      case 'unknown':
        return { status: 'invalid', message: 'Enter an admin email, an Ethiopian phone number (+2519… / 09…) or an id.' };
      case 'uuid':
        return { status: 'resolved', id: input.value, label: input.value, kind: 'unknown' };
      case 'email': {
        if (admin && admin.email.toLowerCase() === input.value) return { status: 'resolved', id: admin.id, label: admin.email, kind: 'admin' };
        if (adminRows.isPending) return { status: 'resolving' };
        const hit = adminRows.data?.data.find((r) => r.actorEmail?.toLowerCase() === input.value && r.actorId);
        return hit?.actorId
          ? { status: 'resolved', id: hit.actorId, label: hit.actorEmail!, kind: 'admin' }
          : { status: 'not_found', message: `No admin actions by ${input.value} in the latest 100 admin entries. Try the admin's id instead.` };
      }
      case 'phone': {
        if (!can('users')) return { status: 'invalid', message: 'Your role cannot look up users; enter the user id instead.' };
        if (users.isPending) return { status: 'resolving' };
        const hit = users.data?.data.find((u) => u.phoneNumber === input.value);
        return hit
          ? { status: 'resolved', id: hit.id, label: `${hit.fullName ?? 'Unnamed'} · ${hit.phoneNumber}`, kind: 'user' }
          : { status: 'not_found', message: `No user with phone ${input.value}.` };
      }
    }
  }, [input, admin, adminRows.isPending, adminRows.data, users.isPending, users.data, can]);
}

const MAX_USER_LOOKUPS = 25;

/**
 * Phone numbers for user-actor ids on the current page. The audit endpoint only decorates admin actors with
 * `actorEmail`, so users are resolved one detail call each (deduplicated, cached 10 min, capped per page).
 */
export function useUserPhones(ids: readonly string[], enabled: boolean): Map<string, string> {
  const unique = useMemo(() => [...new Set(ids)].slice(0, MAX_USER_LOOKUPS), [ids]);
  const results = useQueries({
    queries: unique.map((id) => ({
      queryKey: queryKeys.user(id),
      queryFn: () => usersApi.detail(id),
      enabled,
      staleTime: 10 * 60_000,
      retry: false,
    })),
  });
  return useMemo(() => {
    const map = new Map<string, string>();
    results.forEach((r, i) => {
      if (r.data) map.set(unique[i]!, r.data.phoneNumber);
    });
    return map;
  }, [results, unique]);
}
