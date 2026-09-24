import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

export type ParamValue = string | number | boolean | undefined;

/**
 * Filter / pagination state kept in the URL so views are shareable and survive reloads.
 * `page` resets to 1 whenever any other param changes.
 */
export function useListParams<T extends Record<string, ParamValue>>(defaults: T & { page?: number; limit?: number }) {
  const [searchParams, setSearchParams] = useSearchParams();

  const params = useMemo(() => {
    const out: Record<string, ParamValue> = { ...defaults };
    for (const [key, def] of Object.entries(defaults)) {
      const raw = searchParams.get(key);
      if (raw === null) continue;
      if (typeof def === 'number') {
        const n = Number(raw);
        out[key] = Number.isFinite(n) ? n : def;
      } else if (typeof def === 'boolean') out[key] = raw === 'true';
      else out[key] = raw;
    }
    // Filters not present in defaults but present in the URL (e.g. optional strings).
    for (const [key, raw] of searchParams.entries()) if (!(key in out)) out[key] = raw;
    return out as T & { page: number; limit: number };
  }, [searchParams, defaults]);

  const set = useCallback(
    (patch: Partial<Record<keyof T | 'page' | 'limit', ParamValue>>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          let resetPage = false;
          for (const [key, value] of Object.entries(patch)) {
            if (key !== 'page') resetPage = true;
            const def = (defaults as Record<string, ParamValue>)[key];
            if (value === undefined || value === '' || value === null || value === def) next.delete(key);
            else next.set(key, String(value));
          }
          if (resetPage && !('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams, defaults],
  );

  const reset = useCallback(() => setSearchParams(new URLSearchParams(), { replace: true }), [setSearchParams]);

  return { params, set, reset };
}
