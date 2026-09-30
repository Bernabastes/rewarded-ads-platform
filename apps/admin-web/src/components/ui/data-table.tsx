import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type Row,
  type RowData,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Fragment, type KeyboardEvent, type ReactNode, useRef, useState } from 'react';
import { cn } from '@/lib/utils/cn';
import { formatInt } from '@/lib/utils/format';
import { Button } from './button';
import { EmptyState, ErrorState, SkeletonRows } from './feedback';
import { NativeSelect } from './input';

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: 'left' | 'right' | 'center';
    className?: string;
    headerClassName?: string;
    /** Column is mostly numeric: tabular figures. */
    numeric?: boolean;
  }
}

export interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[] | undefined;
  getRowId?: (row: T, index: number) => string;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  emptyState?: ReactNode;
  onRowClick?: (row: T) => void;
  selectedRowId?: string | null;
  /** Virtualise rows (needs a bounded height via `maxHeight` / `className`). */
  virtualized?: boolean;
  rowHeight?: number;
  /** Height of the scroll container, e.g. "calc(100vh - 260px)". */
  maxHeight?: string;
  className?: string;
  tableClassName?: string;
  renderExpanded?: (row: T) => ReactNode;
  expandedRowId?: string | null;
  sortable?: boolean;
  initialSorting?: SortingState;
  rowClassName?: (row: T) => string | undefined;
  'aria-label'?: string;
}

const alignClass = { left: 'text-left', right: 'text-right', center: 'text-center' };

export function DataTable<T>({
  columns,
  data,
  getRowId,
  isLoading,
  error,
  onRetry,
  emptyState,
  onRowClick,
  selectedRowId,
  virtualized = false,
  rowHeight = 40,
  maxHeight,
  className,
  tableClassName,
  renderExpanded,
  expandedRowId,
  sortable = false,
  initialSorting = [],
  rowClassName,
  'aria-label': ariaLabel,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const rows = data ?? [];
  const table = useReactTable({
    data: rows,
    columns,
    getRowId,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: sortable ? getSortedRowModel() : undefined,
    enableSorting: sortable,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const tableRows = table.getRowModel().rows;
  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
    enabled: virtualized,
  });

  const virtualItems = virtualized ? virtualizer.getVirtualItems() : null;
  // A 0px viewport (jsdom, `display: none` ancestors) makes the virtualizer yield nothing; render plainly rather
  // than an empty table until it can measure.
  const useVirtual = virtualItems !== null && (virtualItems.length > 0 || tableRows.length === 0);
  const paddingTop = useVirtual && virtualItems.length > 0 ? virtualItems[0]!.start : 0;
  const paddingBottom = useVirtual && virtualItems.length > 0 ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1]!.end : 0;

  const colCount = table.getVisibleLeafColumns().length;
  const interactive = Boolean(onRowClick);

  const handleKey = (e: KeyboardEvent<HTMLTableRowElement>, row: Row<T>) => {
    if (!onRowClick) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onRowClick(row.original);
    }
  };

  const renderRow = (row: Row<T>, measureRef?: (el: HTMLTableSectionElement | null) => void, index?: number) => {
    const expanded = renderExpanded && expandedRowId === row.id;
    const selected = selectedRowId === row.id;
    return (
      <tbody key={row.id} ref={measureRef} data-index={index} className="group/body">
        <tr
          tabIndex={interactive ? 0 : undefined}
          role={interactive ? 'button' : undefined}
          aria-selected={interactive ? selected : undefined}
          onClick={onRowClick ? () => onRowClick(row.original) : undefined}
          onKeyDown={(e) => handleKey(e, row)}
          className={cn(
            'border-b transition-colors last:border-b-0',
            interactive && 'cursor-pointer hover:bg-sunken/70 focus-visible:bg-sunken focus-visible:outline-none',
            selected && 'bg-primary-soft hover:bg-primary-soft',
            expanded && 'bg-sunken/50',
            rowClassName?.(row.original),
          )}
          style={useVirtual ? { height: rowHeight } : undefined}
        >
          {row.getVisibleCells().map((cell) => {
            const meta = cell.column.columnDef.meta;
            return (
              <td
                key={cell.id}
                className={cn(
                  'px-3 py-2 align-middle text-sm text-fg',
                  alignClass[meta?.align ?? 'left'],
                  meta?.numeric && 'tabular',
                  meta?.className,
                )}
              >
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </td>
            );
          })}
        </tr>
        {expanded ? (
          <tr className="border-b bg-sunken/40">
            <td colSpan={colCount} className="px-3 py-3">
              {renderExpanded(row.original)}
            </td>
          </tr>
        ) : null}
      </tbody>
    );
  };

  const showSkeleton = isLoading && rows.length === 0;
  const showError = !isLoading && Boolean(error) && rows.length === 0;
  const showEmpty = !isLoading && !error && rows.length === 0;

  return (
    <div
      ref={containerRef}
      className={cn('relative overflow-auto rounded-lg border bg-surface shadow-card', className)}
      style={maxHeight ? { maxHeight } : undefined}
      aria-busy={isLoading || undefined}
    >
      <table className={cn('w-full border-separate border-spacing-0 text-sm', tableClassName)} aria-label={ariaLabel}>
        <thead className="sticky top-0 z-10 bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((header) => {
                const meta = header.column.columnDef.meta;
                const canSort = sortable && header.column.getCanSort();
                const sorted = header.column.getIsSorted();
                const explicitSize = header.column.columnDef.size !== undefined;
                return (
                  <th
                    key={header.id}
                    scope="col"
                    style={explicitSize ? { width: header.getSize(), minWidth: header.column.columnDef.minSize } : undefined}
                    aria-sort={sorted ? (sorted === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cn(
                      'h-9 border-b px-3 text-2xs font-semibold tracking-wider text-fg-subtle uppercase whitespace-nowrap',
                      alignClass[meta?.align ?? 'left'],
                      meta?.headerClassName,
                    )}
                  >
                    {header.isPlaceholder ? null : canSort ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="inline-flex items-center gap-1 hover:text-fg"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {sorted === 'asc' ? <ArrowUp className="size-3" /> : sorted === 'desc' ? <ArrowDown className="size-3" /> : null}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        {showSkeleton || showError || showEmpty ? (
          <tbody>
            <tr>
              <td colSpan={colCount} className="p-0">
                {showSkeleton ? (
                  <SkeletonRows rows={8} columns={Math.min(colCount, 6)} />
                ) : showError ? (
                  <ErrorState error={error} onRetry={onRetry} compact />
                ) : (
                  emptyState ?? <EmptyState compact title="Nothing here" description="No records match the current filters." />
                )}
              </td>
            </tr>
          </tbody>
        ) : useVirtual && virtualItems ? (
          <Fragment>
            {paddingTop > 0 ? (
              <tbody>
                <tr style={{ height: paddingTop }} aria-hidden>
                  <td colSpan={colCount} className="p-0" />
                </tr>
              </tbody>
            ) : null}
            {virtualItems.map((v) => renderRow(tableRows[v.index]!, virtualizer.measureElement, v.index))}
            {paddingBottom > 0 ? (
              <tbody>
                <tr style={{ height: paddingBottom }} aria-hidden>
                  <td colSpan={colCount} className="p-0" />
                </tr>
              </tbody>
            ) : null}
          </Fragment>
        ) : (
          tableRows.map((row) => renderRow(row))
        )}
      </table>
    </div>
  );
}

/* ------------------------------ Pagination ------------------------------ */

export interface PaginationBarProps {
  page: number;
  limit: number;
  total: number | undefined;
  onPageChange: (page: number) => void;
  onLimitChange?: (limit: number) => void;
  limits?: number[];
  className?: string;
  isFetching?: boolean;
}

export function PaginationBar({ page, limit, total, onPageChange, onLimitChange, limits = [20, 50, 100], className, isFetching }: PaginationBarProps) {
  const totalPages = total === undefined ? 1 : Math.max(1, Math.ceil(total / limit));
  const from = total ? (page - 1) * limit + 1 : 0;
  const to = total ? Math.min(total, page * limit) : 0;
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3 px-1 py-2 text-xs text-fg-muted', className)}>
      <div className="flex items-center gap-3">
        <span className="tabular">
          {total === undefined ? '…' : total === 0 ? 'No results' : `${formatInt(from)}–${formatInt(to)} of ${formatInt(total)}`}
        </span>
        {isFetching ? <span className="text-fg-subtle">Updating…</span> : null}
      </div>
      <div className="flex items-center gap-2">
        {onLimitChange ? (
          <label className="flex items-center gap-1.5">
            <span>Rows</span>
            <NativeSelect value={limit} onChange={(e) => onLimitChange(Number(e.target.value))} className="h-7 w-18 text-xs" aria-label="Rows per page">
              {limits.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </label>
        ) : null}
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon-sm" aria-label="First page" disabled={page <= 1} onClick={() => onPageChange(1)}>
            <ChevronsLeft className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            <ChevronLeft className="size-3.5" />
          </Button>
          <span className="min-w-16 text-center tabular">
            {page} / {totalPages}
          </span>
          <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
            <ChevronRight className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Last page" disabled={page >= totalPages} onClick={() => onPageChange(totalPages)}>
            <ChevronsRight className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
