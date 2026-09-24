import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border bg-surface shadow-card', className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3 border-b px-4 py-2.5', className)}>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        {description ? <p className="mt-0.5 text-xs text-fg-subtle">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4', className)} {...props} />;
}

/** Key/value grid used throughout detail views. */
export function DescriptionList({
  items,
  columns = 2,
  className,
}: {
  items: Array<{ label: ReactNode; value: ReactNode; mono?: boolean; span?: 1 | 2 }>;
  columns?: 1 | 2 | 3;
  className?: string;
}) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-2.5', columns === 1 ? 'grid-cols-1' : columns === 2 ? 'grid-cols-2' : 'grid-cols-3', className)}>
      {items.map((item, i) => (
        <div key={i} className={cn('min-w-0', item.span === 2 && 'col-span-2')}>
          <dt className="text-2xs font-medium tracking-wide text-fg-subtle uppercase">{item.label}</dt>
          <dd className={cn('mt-0.5 text-sm text-fg break-words', item.mono && 'font-mono text-xs')}>{item.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cn('border-t', className)} />;
}
