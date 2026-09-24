import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';
import { Button } from './button';

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="scrollbar-thin w-full overflow-x-auto">
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  );
}

export function TableHeader(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className="[&_tr]:border-b [&_tr]:border-border" {...props} />;
}

export function TableBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className="[&_tr:last-child]:border-0" {...props} />;
}

export function TableRow({ className, interactive, ...props }: HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean }) {
  return (
    <tr
      className={cn('border-b border-border transition-colors', interactive && 'cursor-pointer hover:bg-surface-muted/60', className)}
      {...props}
    />
  );
}

export function TableHead({ className, numeric, ...props }: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        'h-11 px-4 text-left align-middle text-xs font-medium tracking-wide text-fg-subtle uppercase first:pl-5 last:pr-5',
        numeric && 'text-right',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, numeric, ...props }: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={cn('px-4 py-3.5 align-middle text-fg first:pl-5 last:pr-5', numeric && 'text-right tabular-nums', className)}
      {...props}
    />
  );
}

export interface PaginationProps {
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
  className?: string;
  itemLabel?: string;
}

export function Pagination({ page, limit, total, onPageChange, className, itemLabel = 'items' }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (total <= limit) return null;
  const from = (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  return (
    <nav className={cn('flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm text-fg-muted', className)} aria-label="Pagination">
      <p className="tabular-nums">
        Showing {from}–{to} of {total} {itemLabel}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon-sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1} aria-label="Previous page">
          <ChevronLeft className="size-4" />
        </Button>
        <span className="tabular-nums">
          Page {page} of {pages}
        </span>
        <Button variant="outline" size="icon-sm" onClick={() => onPageChange(page + 1)} disabled={page >= pages} aria-label="Next page">
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </nav>
  );
}

export function DescriptionList({ items, className }: { items: Array<{ term: ReactNode; detail: ReactNode }>; className?: string }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2', className)}>
      {items.map((item, i) => (
        <div key={i} className="flex flex-col gap-0.5">
          <dt className="text-fg-subtle">{item.term}</dt>
          <dd className="font-medium text-fg">{item.detail}</dd>
        </div>
      ))}
    </dl>
  );
}
