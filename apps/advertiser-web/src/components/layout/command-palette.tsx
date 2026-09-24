import { ArrowRight, Megaphone, Plus, Search } from 'lucide-react';
import { Dialog as RadixDialog } from 'radix-ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useCampaigns } from '@/features/campaigns/hooks';
import { cn } from '@/lib/utils/cn';
import { CAMPAIGN_STATUS_LABEL, CampaignStatusBadge } from '../ui/badge';
import { NAV_ITEMS } from './app-shell';

interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  icon?: typeof Search;
  to: string;
  badge?: React.ReactNode;
  group: 'Pages' | 'Actions' | 'Campaigns';
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const listRef = useRef<HTMLUListElement>(null);
  const { data } = useCampaigns();

  const items = useMemo<PaletteItem[]>(() => {
    const pages: PaletteItem[] = NAV_ITEMS.map((item) => ({
      id: `page:${item.to}`,
      label: item.label,
      icon: item.icon,
      to: item.to,
      group: 'Pages',
    }));
    const actions: PaletteItem[] = [
      {
        id: 'action:new',
        label: 'Create a new campaign',
        icon: Plus,
        to: '/campaigns/new',
        group: 'Actions',
      },
      {
        id: 'action:topup',
        label: 'Add funds to wallet',
        icon: ArrowRight,
        to: '/billing?topup=start',
        group: 'Actions',
      },
    ];
    const campaigns: PaletteItem[] = (data?.data ?? []).map((c) => ({
      id: `campaign:${c.id}`,
      label: c.title,
      hint: CAMPAIGN_STATUS_LABEL[c.status],
      icon: Megaphone,
      to: `/campaigns/${c.id}`,
      badge: <CampaignStatusBadge status={c.status} />,
      group: 'Campaigns',
    }));
    return [...pages, ...actions, ...campaigns];
  }, [data]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => `${item.label} ${item.hint ?? ''}`.toLowerCase().includes(q));
  }, [items, query]);

  useEffect(() => {
    if (!open) return;
    // Reset the palette each time it opens (query is user-owned state, not derived).
    const frame = requestAnimationFrame(() => {
      setQuery('');
      setActive(0);
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const select = (item: PaletteItem) => {
    onOpenChange(false);
    navigate(item.to);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => Math.min(filtered.length - 1, i + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = filtered[Math.min(active, filtered.length - 1)];
      if (item) select(item);
    }
  };

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const groups = ['Pages', 'Actions', 'Campaigns'] as const;

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-stone-950/40 backdrop-blur-[2px] data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
        <RadixDialog.Content
          className="fixed top-[12vh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-surface-elevated shadow-pop outline-none data-[state=open]:animate-slide-up"
          onKeyDown={onKeyDown}
        >
          <RadixDialog.Title className="sr-only">Search</RadixDialog.Title>
          <RadixDialog.Description className="sr-only">Jump to a page or campaign</RadixDialog.Description>
          <div className="flex items-center gap-3 border-b border-border px-4">
            <Search className="size-5 text-fg-subtle" />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              placeholder="Search campaigns or jump to a page…"
              className="h-14 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-subtle"
              role="combobox"
              aria-expanded="true"
              aria-controls="command-palette-list"
              aria-activedescendant={filtered[active] ? `palette-${filtered[active].id}` : undefined}
              aria-autocomplete="list"
            />
            <kbd className="hidden rounded-[6px] border border-border bg-surface-muted px-1.5 py-0.5 font-sans text-[11px] text-fg-subtle sm:block">
              Esc
            </kbd>
          </div>
          <ul
            ref={listRef}
            id="command-palette-list"
            role="listbox"
            className="scrollbar-thin max-h-[50vh] overflow-y-auto p-2"
          >
            {filtered.length === 0 && (
              <li className="px-3 py-8 text-center text-sm text-fg-muted">No matches for “{query}”.</li>
            )}
            {groups.map((group) => {
              const groupItems = filtered.filter((i) => i.group === group);
              if (groupItems.length === 0) return null;
              return (
                <li key={group} role="presentation">
                  <p className="px-3 pt-2 pb-1 text-xs font-medium text-fg-subtle">{group}</p>
                  <ul role="group" aria-label={group}>
                    {groupItems.map((item) => {
                      const index = filtered.indexOf(item);
                      const isActive = index === active;
                      const Icon = item.icon ?? ArrowRight;
                      return (
                        <li
                          key={item.id}
                          id={`palette-${item.id}`}
                          role="option"
                          aria-selected={isActive}
                          data-index={index}
                          onMouseEnter={() => setActive(index)}
                          onClick={() => select(item)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') select(item);
                          }}
                          className={cn(
                            'flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-fg',
                            isActive && 'bg-surface-muted',
                          )}
                        >
                          <Icon className="size-4 text-fg-subtle" />
                          <span className="flex-1 truncate">{item.label}</span>
                          {item.badge}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
