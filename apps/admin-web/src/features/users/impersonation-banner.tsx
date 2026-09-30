import { Eye, EyeOff, TimerOff, X } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { formatCountdown, impersonationStore, useImpersonation, useImpersonationCountdown } from '@/lib/auth/impersonation-store';
import { cn } from '@/lib/utils/cn';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const EXPIRED_AUTO_DISMISS_MS = 20_000;

/**
 * Persistent banner shown under the top bar while a read-only "view as user" session exists.
 * Active: "Viewing as <phone> - read-only, expires in mm:ss". Expired: turns red and the panel route is left.
 */
export function ImpersonationBanner() {
  const state = useImpersonation();
  const remaining = useImpersonationCountdown();
  const navigate = useNavigate();
  const location = useLocation();

  const panelPath = state.session ? `/users/${state.session.user.id}/view-as` : null;
  const onPanel = panelPath !== null && location.pathname === panelPath;

  // Expiry closes the panel (the token is gone) and the banner auto-clears after a short grace period.
  useEffect(() => {
    if (state.status !== 'expired') return;
    if (onPanel && state.session) navigate(`/users/${state.session.user.id}`, { replace: true });
    const id = window.setTimeout(() => impersonationStore.end(), EXPIRED_AUTO_DISMISS_MS);
    return () => window.clearTimeout(id);
  }, [state.status, state.session, onPanel, navigate]);

  if (state.status === 'idle') return null;
  const { user } = state.session;
  const who = user.fullName ? `${user.fullName} (${user.phoneNumber})` : user.phoneNumber;
  const expired = state.status === 'expired';
  const urgent = !expired && remaining < 60_000;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="impersonation-banner"
      data-state={state.status}
      className={cn(
        'sticky top-12 z-20 flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5 text-xs sm:px-5',
        expired ? 'border-danger/40 bg-danger/10 text-fg' : 'border-warning/40 bg-warning/15 text-fg',
      )}
    >
      {expired ? <TimerOff className="size-3.5 shrink-0 text-danger" aria-hidden /> : <Eye className="size-3.5 shrink-0 text-warning" aria-hidden />}
      <span className="min-w-0 flex-1 truncate">
        {expired ? (
          <>
            Impersonation session for <span className="font-mono font-medium">{who}</span> has <span className="font-semibold text-danger">expired</span>. Start a new one from the user page if
            you still need it.
          </>
        ) : (
          <>
            Viewing as <span className="font-mono font-medium">{who}</span> — <span className="font-medium">read-only</span>, expires in{' '}
            <span className={cn('font-mono font-semibold tabular', urgent && 'text-danger')} data-testid="impersonation-countdown">
              {formatCountdown(remaining)}
            </span>
          </>
        )}
      </span>
      {!expired ? (
        <Badge tone="warning" size="sm" className="gap-1">
          <EyeOff className="size-2.5" /> write actions hidden
        </Badge>
      ) : null}
      {!expired && panelPath && !onPanel ? (
        <Link to={panelPath} className="font-medium text-primary hover:underline">
          Open panel
        </Link>
      ) : null}
      <Button variant="ghost" size="xs" onClick={() => impersonationStore.end()} aria-label={expired ? 'Dismiss' : 'End impersonation session'}>
        <X className="size-3" /> {expired ? 'Dismiss' : 'End session'}
      </Button>
    </div>
  );
}
