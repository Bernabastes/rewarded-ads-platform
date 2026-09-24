import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { FlaskConical, Keyboard, Menu, Moon, Sun } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { homeApi } from '@/lib/api/endpoints';
import { queryKeys } from '@/lib/api/query-keys';
import { useAuth } from '@/lib/auth/use-auth';
import { STORAGE_PREFIX } from '@/lib/brand';
import { MOD_LABEL, useHotkeys } from '@/lib/hooks/use-hotkeys';
import { useTheme } from '@/lib/hooks/use-theme';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/feedback';
import { Tooltip } from '@/components/ui/primitives';
import { ALL_NAV_ITEMS } from '@/app/navigation';
import { CommandPalette } from './command-palette';
import { Sidebar } from './sidebar';

const COLLAPSE_KEY = `${STORAGE_PREFIX}.sidebar-collapsed`;

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

export function AppShell() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { can } = useAuth();
  const { resolved, toggle } = useTheme();
  const reduce = useReducedMotion();
  const config = useQuery({ queryKey: queryKeys.config, queryFn: homeApi.config, staleTime: 5 * 60_000 });
  const mockCount = config.data ? Object.values(config.data.mocks).filter(Boolean).length : 0;

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !c;
    });
  }, []);

  // "g" then <key> navigation sequence.
  const pendingG = useRef<number | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (pendingG.current !== null) {
        window.clearTimeout(pendingG.current);
        pendingG.current = null;
        const item = ALL_NAV_ITEMS.find((i) => i.key === e.key.toLowerCase() && can(i.access));
        if (item) {
          e.preventDefault();
          navigate(item.to);
        }
        return;
      }
      if (e.key === 'g') {
        pendingG.current = window.setTimeout(() => {
          pendingG.current = null;
        }, 1200);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [can, navigate]);

  useHotkeys(
    {
      'mod+k': (e) => {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      },
      '?': () => setHelpOpen(true),
      'mod+shift+l': (e) => {
        e.preventDefault();
        toggle();
      },
    },
    { allowInInputs: false },
  );

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex h-full min-h-screen bg-bg">
      <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} onOpenPalette={() => setPaletteOpen(true)} mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b bg-bg/80 px-3 backdrop-blur sm:px-5">
          <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
            <Menu className="size-4" />
          </Button>
          <div className="flex-1" />
          {mockCount > 0 ? (
            <Tooltip
              content={
                <span>
                  Mocked providers: {Object.entries(config.data!.mocks).filter(([, v]) => v).map(([k]) => k).join(', ')}. Real SMS, payouts, checkout and push are
                  simulated by the API.
                </span>
              }
            >
              <span>
                <Badge tone="warning" className="cursor-help gap-1">
                  <FlaskConical className="size-3" /> Mock mode · {mockCount}/4
                </Badge>
              </span>
            </Tooltip>
          ) : null}
          {config.data ? (
            <Badge tone="outline" className="hidden font-mono sm:inline-flex">
              {config.data.environment} · v{config.data.version}
            </Badge>
          ) : null}
          <Tooltip content={`Keyboard shortcuts (?)`}>
            <Button variant="ghost" size="icon-sm" aria-label="Keyboard shortcuts" onClick={() => setHelpOpen(true)}>
              <Keyboard className="size-4" />
            </Button>
          </Tooltip>
          <Tooltip content={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} mode (${MOD_LABEL} ⇧ L)`}>
            <Button variant="ghost" size="icon-sm" aria-label="Toggle theme" onClick={toggle}>
              {resolved === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
          </Tooltip>
        </header>
        <main className="min-w-0 flex-1">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              initial={reduce ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              className="mx-auto w-full max-w-[1600px] px-3 py-4 sm:px-5 sm:py-5"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}

function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { can } = useAuth();
  const nav = ALL_NAV_ITEMS.filter((i) => i.key && can(i.access));
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts" size="lg">
      <div className="grid gap-6 sm:grid-cols-2">
        <section>
          <h4 className="mb-2 text-2xs font-semibold tracking-wider text-fg-subtle uppercase">Global</h4>
          <ShortcutRow keys={[MOD_LABEL, 'K']} label="Command palette" />
          <ShortcutRow keys={['?']} label="This help" />
          <ShortcutRow keys={[MOD_LABEL, '⇧', 'L']} label="Toggle light / dark" />
          <ShortcutRow keys={['Esc']} label="Close dialogs & panels" />
          <h4 className="mt-4 mb-2 text-2xs font-semibold tracking-wider text-fg-subtle uppercase">Ad review</h4>
          <ShortcutRow keys={['J']} label="Next ad" />
          <ShortcutRow keys={['K']} label="Previous ad" />
          <ShortcutRow keys={['A']} label="Approve (when checklist complete)" />
          <ShortcutRow keys={['R']} label="Reject…" />
          <ShortcutRow keys={['1', '–', '8']} label="Toggle banned-topic checkbox" />
          <ShortcutRow keys={['⇧', 'A']} label="Tick every banned topic" />
        </section>
        <section>
          <h4 className="mb-2 text-2xs font-semibold tracking-wider text-fg-subtle uppercase">Go to (press G, then…)</h4>
          {nav.map((i) => (
            <ShortcutRow key={i.to} keys={['G', i.key!.toUpperCase()]} label={i.label} />
          ))}
        </section>
      </div>
    </Dialog>
  );
}

function ShortcutRow({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-sm">
      <span className="text-fg-muted">{label}</span>
      <span className="flex items-center gap-0.5">
        {keys.map((k, i) => (
          <Kbd key={i}>{k}</Kbd>
        ))}
      </span>
    </div>
  );
}
