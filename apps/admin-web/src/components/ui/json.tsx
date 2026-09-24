import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils/cn';
import { countChanges, diffJson, formatJsonValue } from '@/lib/utils/json-diff';
import { Badge } from './badge';
import { Button } from './button';

/** Collapsible pretty JSON block in the mono face. */
export function JsonView({ value, className, maxHeight = 320 }: { value: unknown; className?: string; maxHeight?: number }) {
  const text = useMemo(() => (value === undefined ? 'undefined' : JSON.stringify(value, null, 2)), [value]);
  if (value === null || value === undefined) return <span className="text-xs text-fg-subtle">—</span>;
  return (
    <pre
      className={cn('overflow-auto rounded-md border bg-sunken/60 p-2.5 font-mono text-xs leading-relaxed text-fg-muted', className)}
      style={{ maxHeight }}
    >
      {text}
    </pre>
  );
}

/** Before / after diff with changed keys highlighted. */
export function DiffView({ before, after, className }: { before: unknown; after: unknown; className?: string }) {
  const entries = useMemo(() => diffJson(before, after), [before, after]);
  const changes = countChanges(entries);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const visible = showUnchanged ? entries : entries.filter((e) => e.kind !== 'unchanged');

  if (entries.length === 0) {
    return <p className="text-xs text-fg-subtle">No structured state recorded for this entry.</p>;
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <Badge tone={changes ? 'accent' : 'neutral'}>{changes} changed</Badge>
          <span>{entries.length - changes} unchanged</span>
        </div>
        {entries.length - changes > 0 ? (
          <Button variant="link" size="xs" onClick={() => setShowUnchanged((v) => !v)}>
            {showUnchanged ? 'Hide unchanged' : 'Show unchanged'}
          </Button>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-xs">
          <thead className="bg-sunken/60 text-2xs uppercase tracking-wider text-fg-subtle">
            <tr>
              <th className="px-2.5 py-1.5 text-left font-semibold">Key</th>
              <th className="px-2.5 py-1.5 text-left font-semibold">Before</th>
              <th className="px-2.5 py-1.5 text-left font-semibold">After</th>
            </tr>
          </thead>
          <tbody className="divide-y font-mono">
            {visible.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-2.5 py-2 text-center font-sans text-fg-subtle">
                  Nothing changed.
                </td>
              </tr>
            ) : (
              visible.map((e) => (
                <tr
                  key={e.path}
                  className={cn(
                    e.kind === 'added' && 'bg-success/8',
                    e.kind === 'removed' && 'bg-danger/8',
                    e.kind === 'changed' && 'bg-warning/10',
                  )}
                >
                  <td className="px-2.5 py-1.5 align-top whitespace-nowrap text-fg">
                    <span
                      className={cn(
                        'mr-1.5 inline-block w-3 text-center',
                        e.kind === 'added' && 'text-success',
                        e.kind === 'removed' && 'text-danger',
                        e.kind === 'changed' && 'text-warning',
                        e.kind === 'unchanged' && 'text-fg-subtle',
                      )}
                      aria-label={e.kind}
                    >
                      {e.kind === 'added' ? '+' : e.kind === 'removed' ? '−' : e.kind === 'changed' ? '~' : '·'}
                    </span>
                    {e.path}
                  </td>
                  <td className={cn('px-2.5 py-1.5 align-top break-all', e.kind === 'changed' || e.kind === 'removed' ? 'text-danger line-through decoration-danger/50' : 'text-fg-muted')}>
                    {formatJsonValue(e.before)}
                  </td>
                  <td className={cn('px-2.5 py-1.5 align-top break-all', e.kind === 'changed' || e.kind === 'added' ? 'font-semibold text-success' : 'text-fg-muted')}>
                    {formatJsonValue(e.after)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
