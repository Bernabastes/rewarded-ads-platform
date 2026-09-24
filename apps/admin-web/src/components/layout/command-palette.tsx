import { Command } from 'cmdk';
import { LogOut, Moon, Search, Sun, SunMoon, UserSearch } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/lib/auth/use-auth';
import { useTheme } from '@/lib/hooks/use-theme';
import { Kbd } from '@/components/ui/feedback';
import { Dialog } from '@/components/ui/dialog';
import { NAV_SECTIONS } from '@/app/navigation';

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { can, logout } = useAuth();
  const { setTheme } = useTheme();
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  const looksLikePhone = /^\+?\d{4,}$/.test(search.replace(/\s+/g, ''));

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      size="md"
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        inputRef.current?.focus();
      }}
    >
      <Command label="Command palette" className="-m-5 [&_[cmdk-input]]:outline-none">
        <div className="flex items-center gap-2 border-b px-4">
          <Search className="size-4 shrink-0 text-fg-subtle" aria-hidden />
          <Command.Input
            ref={inputRef}
            autoFocus
            value={search}
            onValueChange={setSearch}
            placeholder="Jump to a page, search a user, change theme…"
            className="h-11 w-full bg-transparent text-sm text-fg placeholder:text-fg-subtle"
          />
          <Kbd>Esc</Kbd>
        </div>
        <Command.List className="max-h-[60vh] overflow-y-auto p-2 [&_[cmdk-item][data-selected=true]]:bg-sunken">
          <Command.Empty className="px-2 py-8 text-center text-sm text-fg-subtle">No results.</Command.Empty>

          {looksLikePhone && can('users') ? (
            <Command.Group heading="Users">
              <Command.Item value={`search user ${search}`} onSelect={() => run(() => navigate(`/users?q=${encodeURIComponent(search.trim())}`))} className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm">
                <UserSearch className="size-4 text-fg-subtle" />
                Search users for <span className="font-mono">{search.trim()}</span>
              </Command.Item>
            </Command.Group>
          ) : null}

          {NAV_SECTIONS.map((section) => {
            const items = section.items.filter((i) => can(i.access));
            if (!items.length) return null;
            return (
              <Command.Group key={section.title} heading={section.title}>
                {items.map((item) => (
                  <Command.Item
                    key={item.to}
                    value={`${item.label} ${item.description ?? ''}`}
                    onSelect={() => run(() => navigate(item.to))}
                    className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm text-fg"
                  >
                    <item.icon className="size-4 text-fg-subtle" aria-hidden />
                    <span className="flex-1">{item.label}</span>
                    {item.description ? <span className="truncate text-xs text-fg-subtle">{item.description}</span> : null}
                    {item.key ? (
                      <span className="ml-2 flex items-center gap-0.5">
                        <Kbd>G</Kbd>
                        <Kbd>{item.key.toUpperCase()}</Kbd>
                      </span>
                    ) : null}
                  </Command.Item>
                ))}
              </Command.Group>
            );
          })}

          <Command.Group heading="Appearance">
            <Command.Item value="theme light" onSelect={() => run(() => setTheme('light'))} className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm">
              <Sun className="size-4 text-fg-subtle" /> Light theme
            </Command.Item>
            <Command.Item value="theme dark" onSelect={() => run(() => setTheme('dark'))} className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm">
              <Moon className="size-4 text-fg-subtle" /> Dark theme
            </Command.Item>
            <Command.Item value="theme system" onSelect={() => run(() => setTheme('system'))} className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm">
              <SunMoon className="size-4 text-fg-subtle" /> Follow system theme
            </Command.Item>
          </Command.Group>

          <Command.Group heading="Session">
            <Command.Item value="sign out logout" onSelect={() => run(() => void logout('manual'))} className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm text-danger">
              <LogOut className="size-4" /> Sign out
            </Command.Item>
          </Command.Group>
        </Command.List>
      </Command>
    </Dialog>
  );
}
