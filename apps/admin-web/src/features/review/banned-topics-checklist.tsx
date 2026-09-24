import { BANNED_TOPICS, type BannedTopicKey } from '@rap/shared';
import { ShieldCheck } from 'lucide-react';
import { type Checks, checkedCount } from '@/lib/domain/review-rules';
import { cn } from '@/lib/utils/cn';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/feedback';
import { Textarea } from '@/components/ui/input';
import { Progress } from '@/components/ui/page';
import { Checkbox } from '@/components/ui/primitives';

export interface BannedTopicsChecklistProps {
  checks: Checks;
  onChange: (checks: Checks) => void;
  notes: string;
  onNotesChange: (notes: string) => void;
  disabled?: boolean;
  /** Keys the reviewer marked as PRESENT in the ad (only meaningful for rejection). */
  flagged?: BannedTopicKey[];
  onToggleFlagged?: (key: BannedTopicKey) => void;
}

/**
 * The reviewer must explicitly confirm that the creative does NOT contain each banned topic.
 * Approve stays disabled until all items are ticked; the server rejects partial checklists too.
 */
export function BannedTopicsChecklist({ checks, onChange, notes, onNotesChange, disabled, flagged = [], onToggleFlagged }: BannedTopicsChecklistProps) {
  const done = checkedCount(checks);
  const total = BANNED_TOPICS.length;
  const complete = done === total;

  return (
    <section aria-labelledby="banned-topics-heading" className="rounded-lg border bg-surface">
      <header className="flex items-center justify-between gap-3 border-b px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <ShieldCheck className={cn('size-4', complete ? 'text-success' : 'text-fg-subtle')} />
          <h3 id="banned-topics-heading" className="text-sm font-semibold text-fg">
            Banned-topics checklist
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn('text-xs tabular', complete ? 'font-medium text-success' : 'text-fg-muted')}>
            {done}/{total} confirmed absent
          </span>
          <Button variant="ghost" size="xs" disabled={disabled} onClick={() => onChange(Object.fromEntries(BANNED_TOPICS.map((t) => [t.key, !complete])) as Checks)}>
            {complete ? 'Clear all' : 'Tick all'} <Kbd className="ml-1">⇧A</Kbd>
          </Button>
        </div>
      </header>
      <Progress value={done} max={total} className="rounded-none" tone={complete ? 'primary' : 'accent'} />
      <ul className="divide-y">
        {BANNED_TOPICS.map((topic, i) => {
          const isFlagged = flagged.includes(topic.key);
          return (
            <li key={topic.key} className={cn('flex items-center gap-3 px-3.5 py-2', isFlagged && 'bg-danger/6')}>
              <Kbd className="shrink-0">{i + 1}</Kbd>
              <div className="min-w-0 flex-1">
                <Checkbox
                  id={`topic-${topic.key}`}
                  checked={checks[topic.key]}
                  disabled={disabled || isFlagged}
                  onCheckedChange={(v) => onChange({ ...checks, [topic.key]: v === true })}
                  label={<span className={cn(isFlagged && 'line-through opacity-70')}>Does not contain: {topic.label}</span>}
                />
              </div>
              {onToggleFlagged ? (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onToggleFlagged(topic.key)}
                  className={cn(
                    'shrink-0 rounded-md border px-1.5 py-0.5 text-2xs font-medium transition-colors',
                    isFlagged ? 'border-danger/40 bg-danger/12 text-danger' : 'border-transparent text-fg-subtle hover:border-border-strong hover:text-fg',
                  )}
                  aria-pressed={isFlagged}
                  aria-label={`Mark "${topic.label}" as present in this ad`}
                >
                  {isFlagged ? 'Present' : 'Flag'}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="border-t px-3.5 py-2.5">
        <label htmlFor="checklist-notes" className="mb-1 block text-xs font-medium text-fg-muted">
          Reviewer notes <span className="font-normal text-fg-subtle">(optional, stored with the checklist)</span>
        </label>
        <Textarea id="checklist-notes" rows={2} value={notes} disabled={disabled} maxLength={1000} onChange={(e) => onNotesChange(e.target.value)} placeholder="e.g. Coffee product; no claims about health benefits." />
      </div>
    </section>
  );
}

/** Read-only rendering of a stored checklist (history tab). */
export function ChecklistSummary({ checks, notes }: { checks: Partial<Record<string, boolean>> | null | undefined; notes?: string | null }) {
  if (!checks) return <p className="text-xs text-fg-subtle">No checklist was recorded with this decision.</p>;
  return (
    <div className="space-y-2">
      <ul className="grid gap-1 sm:grid-cols-2">
        {BANNED_TOPICS.map((t) => (
          <li key={t.key} className="flex items-center gap-2 text-xs">
            <span className={cn('size-1.5 rounded-full', checks[t.key] ? 'bg-success' : 'bg-danger')} aria-hidden />
            <span className={cn(checks[t.key] ? 'text-fg-muted' : 'font-medium text-danger')}>{t.label}</span>
          </li>
        ))}
      </ul>
      {notes ? <p className="rounded-md bg-sunken/60 px-2.5 py-1.5 text-xs text-fg-muted">“{notes}”</p> : null}
    </div>
  );
}
