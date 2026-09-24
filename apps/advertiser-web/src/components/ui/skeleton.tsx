import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn('skeleton h-4 w-full', className)} {...props} />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-3.5', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="card-surface flex flex-col gap-4 p-5" aria-hidden="true">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="size-9 rounded-md" />
      </div>
      <Skeleton className="h-8 w-36" />
      <Skeleton className="h-3 w-24" />
    </div>
  );
}

export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('flex h-64 items-end gap-2 px-2 pt-6', className)} aria-hidden="true">
      {[40, 65, 50, 80, 60, 90, 70, 55, 75, 85, 45, 68].map((height, i) => (
        <Skeleton key={i} className="flex-1 rounded-t-sm" style={{ height: `${height}%` }} />
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="flex flex-col divide-y divide-border" aria-hidden="true">
      {Array.from({ length: rows }, (_, r) => (
        <div
          key={r}
          className="grid gap-4 px-5 py-4"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className={cn('h-4', c === 0 ? 'w-3/4' : 'w-1/2')} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ListSkeleton({ items = 3 }: { items?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      {Array.from({ length: items }, (_, i) => (
        <div key={i} className="card-surface flex items-center gap-4 p-4">
          <Skeleton className="size-12 rounded-md" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** Announce loading to assistive tech once, next to purely visual skeletons. */
export function LoadingAnnouncer({ label = 'Loading' }: { label?: string }) {
  return (
    <span className="sr-only" role="status" aria-live="polite">
      {label}
    </span>
  );
}
