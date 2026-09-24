import { Check, ChevronRight, Copy } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useCopy } from '@/lib/hooks/use-misc';
import { cn } from '@/lib/utils/cn';
import { shortId } from '@/lib/utils/format';
import { Tooltip } from './primitives';

export interface Crumb {
  label: ReactNode;
  to?: string;
}

export function PageHeader({
  title,
  description,
  crumbs,
  actions,
  className,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  crumbs?: Crumb[];
  actions?: ReactNode;
  className?: string;
  /** Row rendered under the title (filters, tabs, ...) */
  children?: ReactNode;
}) {
  return (
    <header className={cn('mb-4', className)}>
      {crumbs?.length ? (
        <nav aria-label="Breadcrumb" className="mb-1 flex items-center gap-1 text-xs text-fg-subtle">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 ? <ChevronRight className="size-3" aria-hidden /> : null}
              {c.to ? (
                <Link to={c.to} className="hover:text-fg">
                  {c.label}
                </Link>
              ) : (
                <span className="text-fg-muted">{c.label}</span>
              )}
            </span>
          ))}
        </nav>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-fg">{title}</h1>
          {description ? <p className="mt-0.5 text-sm text-fg-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children ? <div className="mt-3">{children}</div> : null}
    </header>
  );
}

export function CopyButton({ value, label = 'Copy', className }: { value: string; label?: string; className?: string }) {
  const { copied, copy } = useCopy();
  return (
    <Tooltip content={copied ? 'Copied' : label}>
      <button
        type="button"
        onClick={() => void copy(value)}
        aria-label={label}
        className={cn('inline-flex size-5 items-center justify-center rounded text-fg-subtle hover:bg-sunken hover:text-fg', className)}
      >
        {copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
      </button>
    </Tooltip>
  );
}

/** Monospace short id with copy affordance. */
export function IdChip({ id, length = 8, className, to }: { id: string | null | undefined; length?: number; className?: string; to?: string }) {
  if (!id) return <span className="text-fg-subtle">—</span>;
  const inner = <span className="font-mono text-xs text-fg-muted">{shortId(id, length)}</span>;
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {to ? (
        <Link to={to} className="hover:text-primary hover:underline">
          {inner}
        </Link>
      ) : (
        <Tooltip content={id}>{inner}</Tooltip>
      )}
      <CopyButton value={id} label="Copy id" />
    </span>
  );
}

export function Initials({ name, className }: { name: string | null | undefined; className?: string }) {
  const text = (name ?? '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0] ?? '')
    .join('')
    .toUpperCase();
  return (
    <span
      aria-hidden
      className={cn('flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-2xs font-semibold text-primary', className)}
    >
      {text || '?'}
    </span>
  );
}

export function Progress({ value, max = 1, className, tone = 'primary' }: { value: number; max?: number; className?: string; tone?: 'primary' | 'accent' | 'danger' }) {
  const pct = max === 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-sunken', className)} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div
        className={cn('h-full rounded-full transition-[width] duration-500', tone === 'accent' ? 'bg-accent' : tone === 'danger' ? 'bg-danger' : 'bg-primary')}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
