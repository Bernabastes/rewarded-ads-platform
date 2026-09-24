import type { AdminUserListItem } from '@rap/shared';
import { useQuery } from '@tanstack/react-query';
import { Check, Search, UserRound } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { usersApi } from '@/lib/api/endpoints';
import { queryKeys } from '@/lib/api/query-keys';
import { useDebouncedValue } from '@/lib/hooks/use-misc';
import { cn } from '@/lib/utils/cn';
import { formatCoins } from '@/lib/utils/format';
import { StatusBadge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/feedback';

export interface UserPickerProps {
  value: AdminUserListItem | null;
  onChange: (user: AdminUserListItem | null) => void;
  invalid?: boolean;
  id?: string;
  describedBy?: string;
}

/** Accessible combobox that searches users by phone or name via GET /admin/users?q=. */
export function UserPicker({ value, onChange, invalid, id, describedBy }: UserPickerProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const debounced = useDebouncedValue(query.trim(), 250);
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);

  const results = useQuery({
    queryKey: queryKeys.users({ q: debounced, limit: 8, picker: true }),
    queryFn: () => usersApi.list({ q: debounced, limit: 8 }),
    enabled: open && debounced.length >= 2,
    staleTime: 30_000,
  });
  const options = results.data?.data ?? [];

  useEffect(() => setActive(0), [options.length, debounced]);
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  if (value) {
    return (
      <div className={cn('flex items-center gap-3 rounded-md border bg-sunken/40 px-3 py-2', invalid && 'border-danger')}>
        <span className="flex size-8 items-center justify-center rounded-full bg-primary-soft text-primary">
          <UserRound className="size-4" />
        </span>
        <div className="min-w-0 flex-1 text-sm">
          <div className="flex items-center gap-2 truncate font-medium">
            {value.fullName ?? <span className="text-fg-subtle">Unnamed</span>}
            <StatusBadge status={value.status} size="sm" />
          </div>
          <div className="font-mono text-2xs text-fg-subtle">
            {value.phoneNumber} · balance {formatCoins(value.coinBalance)} coins · trust {value.trustScore}
          </div>
        </div>
        <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => onChange(null)}>
          Change
        </button>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-subtle" aria-hidden />
        <Input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-describedby={describedBy}
          aria-activedescendant={open && options[active] ? `${listId}-${options[active].id}` : undefined}
          invalid={invalid}
          className="pl-8"
          placeholder="Search by phone (+2519…) or name"
          value={query}
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(options.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter' && open && options[active]) {
              e.preventDefault();
              onChange(options[active]);
              setOpen(false);
            } else if (e.key === 'Escape') setOpen(false);
          }}
        />
        {results.isFetching ? <Spinner className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2" /> : null}
      </div>
      {open ? (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-elevated p-1 shadow-pop">
          {debounced.length < 2 ? (
            <li className="px-2 py-2 text-xs text-fg-subtle">Type at least 2 characters.</li>
          ) : results.isPending ? (
            <li className="px-2 py-2 text-xs text-fg-subtle">Searching…</li>
          ) : options.length === 0 ? (
            <li className="px-2 py-2 text-xs text-fg-subtle">No users match “{debounced}”.</li>
          ) : (
            options.map((u, i) => (
              <li
                key={u.id}
                id={`${listId}-${u.id}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(u);
                  setOpen(false);
                }}
                className={cn('flex cursor-default items-center gap-2 rounded px-2 py-1.5 text-sm', i === active && 'bg-sunken')}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{u.fullName ?? <span className="text-fg-subtle">Unnamed</span>}</div>
                  <div className="font-mono text-2xs text-fg-subtle">
                    {u.phoneNumber} · {formatCoins(u.coinBalance)} coins
                  </div>
                </div>
                <StatusBadge status={u.status} size="sm" />
                {i === active ? <Check className="size-3.5 text-primary" /> : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
