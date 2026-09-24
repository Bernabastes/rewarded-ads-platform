import { useQuery } from '@tanstack/react-query';
import { ChevronsLeft, ChevronsRight, LogOut, Moon, Search, Sun, SunMoon } from 'lucide-react';
import { NavLink } from 'react-router';
import { homeApi } from '@/lib/api/endpoints';
import { queryKeys } from '@/lib/api/query-keys';
import { ROLE_LABEL } from '@/lib/auth/rbac';
import { useAuth } from '@/lib/auth/use-auth';
import { APP_NAME, BRAND_NAME, BRAND_NAME_AM } from '@/lib/brand';
import { MOD_LABEL } from '@/lib/hooks/use-hotkeys';
import { useTheme } from '@/lib/hooks/use-theme';
import { cn } from '@/lib/utils/cn';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/feedback';
import { Initials } from '@/components/ui/page';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Tooltip } from '@/components/ui/primitives';
import { NAV_SECTIONS } from '@/app/navigation';

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg bg-forest-600 text-forest-50 shadow-xs', className)} aria-hidden>
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3.5 2" className="text-terracotta-300" stroke="currentColor" />
      </svg>
    </span>
  );
}

export interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  onOpenPalette: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function Sidebar({ collapsed, onToggle, onOpenPalette, mobileOpen, onMobileClose }: SidebarProps) {
  const { admin, can, logout } = useAuth();
  const { preference, resolved, setTheme } = useTheme();
  const overview = useQuery({ queryKey: queryKeys.overview, queryFn: homeApi.overview, staleTime: 30_000, refetchInterval: 60_000 });

  const sections = NAV_SECTIONS.map((s) => ({ ...s, items: s.items.filter((i) => can(i.access)) })).filter((s) => s.items.length > 0);

  return (
    <>
      {mobileOpen ? <div className="fixed inset-0 z-30 bg-stone-950/40 lg:hidden" onClick={onMobileClose} aria-hidden /> : null}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex flex-col border-r bg-surface transition-[width,transform] duration-200 ease-out-soft lg:static lg:translate-x-0',
          collapsed ? 'w-14' : 'w-56',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label="Primary"
      >
        <div className={cn('flex h-12 items-center gap-2 border-b px-3', collapsed && 'justify-center px-0')}>
          <BrandMark />
          {!collapsed ? (
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-semibold tracking-tight text-fg">{APP_NAME}</div>
              <div className="truncate text-2xs text-fg-subtle">
                {BRAND_NAME_AM} · {BRAND_NAME} platform console
              </div>
            </div>
          ) : null}
        </div>

        <div className={cn('px-2 pt-2', collapsed && 'px-1.5')}>
          <Tooltip content={`Search & commands (${MOD_LABEL} K)`} side="right" disabled={!collapsed}>
            <button
              type="button"
              onClick={onOpenPalette}
              className={cn(
                'flex h-8 w-full items-center gap-2 rounded-md border bg-sunken/70 px-2 text-xs text-fg-muted transition-colors hover:bg-sunken hover:text-fg',
                collapsed && 'justify-center px-0',
              )}
            >
              <Search className="size-3.5 shrink-0" />
              {!collapsed ? (
                <>
                  <span className="flex-1 text-left">Search…</span>
                  <span className="flex items-center gap-0.5">
                    <Kbd>{MOD_LABEL}</Kbd>
                    <Kbd>K</Kbd>
                  </span>
                </>
              ) : null}
            </button>
          </Tooltip>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-2" aria-label="Sections">
          {sections.map((section) => (
            <div key={section.title} className="mb-3">
              {!collapsed ? <div className="px-2 pb-1 text-2xs font-semibold tracking-wider text-fg-subtle uppercase">{section.title}</div> : <div className="mx-2 mb-2 border-t" />}
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const count = item.counter ? overview.data?.[item.counter] : undefined;
                  return (
                    <li key={item.to}>
                      <Tooltip content={item.label} side="right" disabled={!collapsed}>
                        <NavLink
                          to={item.to}
                          end={item.to === '/'}
                          onClick={onMobileClose}
                          className={({ isActive }) =>
                            cn(
                              'group flex h-8 items-center gap-2.5 rounded-md px-2 text-sm font-medium transition-colors',
                              isActive ? 'bg-primary-soft text-primary' : 'text-fg-muted hover:bg-sunken hover:text-fg',
                              collapsed && 'justify-center px-0',
                            )
                          }
                        >
                          <item.icon className="size-4 shrink-0" aria-hidden />
                          {!collapsed ? <span className="flex-1 truncate">{item.label}</span> : null}
                          {!collapsed && count ? (
                            <Badge tone="accent" size="sm" className="tabular">
                              {count > 99 ? '99+' : count}
                            </Badge>
                          ) : collapsed && count ? (
                            <span className="absolute top-1 right-1.5 size-1.5 rounded-full bg-accent" aria-label={`${count} pending`} />
                          ) : null}
                        </NavLink>
                      </Tooltip>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className={cn('border-t p-2', collapsed && 'p-1.5')}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn('flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-sunken', collapsed && 'justify-center px-0')}
                aria-label="Account menu"
              >
                <Initials name={admin?.fullName ?? admin?.email} />
                {!collapsed ? (
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-xs font-medium text-fg">{admin?.fullName ?? admin?.email}</span>
                    <span className="block truncate text-2xs text-fg-subtle">{admin ? ROLE_LABEL[admin.role] : ''}</span>
                  </span>
                ) : null}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-56">
              <DropdownMenuLabel className="normal-case tracking-normal">
                <span className="block truncate text-xs font-medium text-fg">{admin?.email}</span>
                <span className="mt-0.5 inline-flex">
                  <Badge tone="primary" size="sm">
                    {admin ? ROLE_LABEL[admin.role] : ''}
                  </Badge>
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Theme</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setTheme('light')}>
                <Sun className="size-3.5" /> Light {preference === 'light' ? <span className="ml-auto text-2xs text-fg-subtle">✓</span> : null}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setTheme('dark')}>
                <Moon className="size-3.5" /> Dark {preference === 'dark' ? <span className="ml-auto text-2xs text-fg-subtle">✓</span> : null}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setTheme('system')}>
                <SunMoon className="size-3.5" /> System {preference === 'system' ? <span className="ml-auto text-2xs text-fg-subtle">✓ ({resolved})</span> : null}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => void logout('manual')}>
                <LogOut className="size-3.5" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="sm" className={cn('mt-1 hidden w-full justify-start text-fg-subtle lg:flex', collapsed && 'justify-center')} onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <ChevronsRight className="size-3.5" /> : <ChevronsLeft className="size-3.5" />}
            {!collapsed ? <span className="text-xs">Collapse</span> : null}
          </Button>
        </div>
      </aside>
    </>
  );
}
