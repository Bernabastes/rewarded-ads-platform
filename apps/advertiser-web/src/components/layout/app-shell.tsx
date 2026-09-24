import { BarChart3, CreditCard, LayoutDashboard, LogOut, Megaphone, Menu, Plus, Search, Settings, Wallet } from 'lucide-react';
import { Dialog as RadixDialog } from 'radix-ui';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '@/features/auth/auth-provider';
import { useWalletBalance } from '@/features/billing/hooks';
import { cn } from '@/lib/utils/cn';
import { formatEtb } from '@/lib/utils/format';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Tooltip } from '../ui/primitives';
import { Skeleton } from '../ui/skeleton';
import { BrandLogo } from './brand-logo';
import { CommandPalette } from './command-palette';
import { ThemeToggle } from './theme-toggle';

export const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/campaigns', label: 'Campaigns', icon: Megaphone },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/billing', label: 'Billing', icon: CreditCard },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const;

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-1 flex-col gap-1" aria-label="Main">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={'end' in item ? item.end : false}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'group flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
              isActive
                ? 'bg-primary-soft text-primary'
                : 'text-fg-muted hover:bg-surface-muted hover:text-fg',
            )
          }
        >
          {({ isActive }) => (
            <>
              <item.icon className={cn('size-5 shrink-0', isActive ? 'text-primary' : 'text-fg-subtle group-hover:text-fg')} />
              {item.label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function WalletChip() {
  const { data, isPending, isError } = useWalletBalance();
  if (isError) return null;
  return (
    <Tooltip content="Available wallet balance">
      <Link
        to="/billing"
        className="hidden min-h-11 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm transition-colors hover:border-border-strong hover:bg-surface-muted sm:inline-flex"
      >
        <Wallet className="size-4 text-primary" />
        {isPending || !data ? (
          <Skeleton className="h-3.5 w-24" />
        ) : (
          <span className="font-semibold tabular-nums text-fg">{formatEtb(data.balanceEtb)}</span>
        )}
      </Link>
    </Tooltip>
  );
}

function UserMenu() {
  const { profile, logout } = useAuth();
  const navigate = useNavigate();
  if (!profile) return null;
  const initials = profile.businessName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0))
    .join('')
    .toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex min-h-11 items-center gap-2.5 rounded-md px-1.5 text-left transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-label="Account menu"
        >
          <span className="flex size-9 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-fg">
            {initials}
          </span>
          <span className="hidden max-w-40 flex-col leading-tight lg:flex">
            <span className="truncate text-sm font-medium text-fg">{profile.businessName}</span>
            <span className="truncate text-xs text-fg-subtle">{profile.contactEmail}</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-60">
        <DropdownMenuLabel>
          <span className="block truncate text-sm font-medium text-fg">{profile.businessName}</span>
          <span className="block truncate font-normal">{profile.contactEmail}</span>
        </DropdownMenuLabel>
        <div className="px-2.5 pb-2">
          <Badge tone={profile.verificationStatus === 'verified' ? 'success' : profile.verificationStatus === 'pending' ? 'warning' : 'danger'} dot size="sm">
            {profile.verificationStatus === 'verified' ? 'Verified' : profile.verificationStatus === 'pending' ? 'Verification pending' : 'Verification rejected'}
          </Badge>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/settings')}>
          <Settings className="size-4" /> Account settings
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate('/billing')}>
          <CreditCard className="size-4" /> Billing
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          destructive
          onSelect={() => {
            void logout().then(() => navigate('/login', { replace: true }));
          }}
        >
          <LogOut className="size-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { profile } = useAuth();
  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <Link to="/" className="rounded-md px-2 py-1" onClick={onNavigate} aria-label="Dashboard">
        <BrandLogo />
      </Link>
      <Button asChild className="w-full justify-start" leadingIcon={undefined}>
        <Link to="/campaigns/new" onClick={onNavigate}>
          <Plus className="size-4" />
          New campaign
        </Link>
      </Button>
      <NavItems onNavigate={onNavigate} />
      {profile && profile.verificationStatus !== 'verified' && (
        <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-xs leading-relaxed text-fg-muted">
          <p className="font-medium text-fg">Verification pending</p>
          <p className="mt-0.5">Drafts and top-ups are open; submitting unlocks after approval.</p>
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children?: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-border bg-surface lg:block">
        <SidebarContent />
      </aside>

      <RadixDialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <RadixDialog.Portal>
          <RadixDialog.Overlay className="fixed inset-0 z-40 bg-stone-950/40 data-[state=open]:animate-fade-in lg:hidden" />
          <RadixDialog.Content className="fixed inset-y-0 left-0 z-50 w-72 border-r border-border bg-surface shadow-pop outline-none data-[state=open]:animate-slide-in-right lg:hidden">
            <RadixDialog.Title className="sr-only">Navigation</RadixDialog.Title>
            <RadixDialog.Description className="sr-only">Main navigation menu</RadixDialog.Description>
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-bg/85 px-4 backdrop-blur-md sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu className="size-5" />
          </Button>
          <Link to="/" className="lg:hidden" aria-label="Dashboard">
            <BrandLogo compact />
          </Link>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="ml-auto hidden h-11 w-72 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm text-fg-subtle transition-colors hover:border-border-strong md:flex"
          >
            <Search className="size-4" />
            <span className="flex-1 text-left">Search campaigns, pages…</span>
            <kbd className="rounded-[6px] border border-border bg-surface-muted px-1.5 py-0.5 font-sans text-[11px] text-fg-subtle">Ctrl K</kbd>
          </button>
          <Button variant="ghost" size="icon" className="ml-auto md:ml-0 md:hidden" onClick={() => setPaletteOpen(true)} aria-label="Search">
            <Search className="size-5" />
          </Button>
          <WalletChip />
          <ThemeToggle />
          <UserMenu />
        </header>

        <main id="main" className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8" key={location.pathname}>
          <div className="mx-auto w-full max-w-7xl">{children ?? <Outlet />}</div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
