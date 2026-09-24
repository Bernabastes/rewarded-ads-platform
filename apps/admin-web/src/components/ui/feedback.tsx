import type { LucideIcon } from 'lucide-react';
import { AlertOctagon, Inbox, RefreshCw, ShieldOff } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { describeError } from '@/lib/api/errors';
import { cn } from '@/lib/utils/cn';
import { Button } from './button';

/* -------------------------------- Skeleton ------------------------------- */

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-stone-200/80 dark:bg-stone-800', className)} {...props} />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-3" style={{ width: `${100 - (i % 3) * 18}%` }} />
      ))}
    </div>
  );
}

export function SkeletonRows({ rows = 8, columns = 5, className }: { rows?: number; columns?: number; className?: string }) {
  return (
    <div className={cn('divide-y', className)} aria-hidden aria-busy>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-3 py-2.5">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} className="h-3" style={{ width: `${c === 0 ? 22 : 10 + ((r + c) % 4) * 6}%` }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-lg border bg-surface p-4 shadow-card', className)} aria-hidden>
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-7 w-20" />
      <Skeleton className="mt-2 h-3 w-32" />
    </div>
  );
}

/* --------------------------------- States -------------------------------- */

export interface StateProps {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}

function IllustrationRing({ icon: Icon, tone }: { icon: LucideIcon; tone: 'neutral' | 'danger' | 'warning' }) {
  return (
    <div className="relative mb-4 flex items-center justify-center" aria-hidden>
      <div
        className={cn(
          'absolute size-20 rounded-full opacity-60 blur-xl',
          tone === 'danger' ? 'bg-danger/30' : tone === 'warning' ? 'bg-warning/30' : 'bg-primary/25',
        )}
      />
      <div
        className={cn(
          'relative flex size-12 items-center justify-center rounded-2xl border bg-surface shadow-card',
          tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-primary',
        )}
      >
        <Icon className="size-5" />
      </div>
    </div>
  );
}

export function EmptyState({ icon = Inbox, title, description, action, className, compact }: StateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'px-4 py-8' : 'px-6 py-16', className)}>
      <IllustrationRing icon={icon} tone="neutral" />
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {description ? <p className="mt-1 max-w-sm text-xs leading-relaxed text-fg-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  error,
  title = 'Something went wrong',
  onRetry,
  className,
  compact,
}: {
  error?: unknown;
  title?: ReactNode;
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center text-center', compact ? 'px-4 py-8' : 'px-6 py-16', className)}>
      <IllustrationRing icon={AlertOctagon} tone="danger" />
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {error ? <p className="mt-1 max-w-sm text-xs leading-relaxed text-fg-muted">{describeError(error)}</p> : null}
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          <RefreshCw className="size-3.5" /> Try again
        </Button>
      ) : null}
    </div>
  );
}

export function NoAccessState({ requiredRoles, className }: { requiredRoles?: readonly string[]; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-16 text-center', className)}>
      <IllustrationRing icon={ShieldOff} tone="warning" />
      <h3 className="text-sm font-semibold text-fg">You don’t have access to this area</h3>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-fg-muted">
        Your admin role can’t open this page. Access is granted by the platform team, and every attempt is logged.
        {requiredRoles?.length ? (
          <>
            {' '}
            Allowed roles: <span className="font-medium text-fg">{requiredRoles.map((r) => r.replace('_', ' ')).join(', ')}</span>.
          </>
        ) : null}
      </p>
    </div>
  );
}

/* ---------------------------------- Kbd ---------------------------------- */

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border border-border-strong bg-sunken px-1 font-sans text-2xs font-medium text-fg-muted shadow-[inset_0_-1px_0_var(--color-border-strong)]',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn('inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent text-fg-subtle', className)}
    />
  );
}
