import { PLATFORM_DEFAULTS } from '@rap/shared';
import { Users } from 'lucide-react';
import { Tooltip } from '@/components/ui/primitives';
import { cn } from '@/lib/utils/cn';

export const MIN_FREQUENCY_CAP = PLATFORM_DEFAULTS.MIN_FREQUENCY_CAP;
export const MAX_FREQUENCY_CAP = PLATFORM_DEFAULTS.MAX_FREQUENCY_CAP;
export const DEFAULT_FREQUENCY_CAP = PLATFORM_DEFAULTS.DEFAULT_FREQUENCY_CAP;

export const FREQUENCY_CAP_OPTIONS = Array.from(
  { length: MAX_FREQUENCY_CAP - MIN_FREQUENCY_CAP + 1 },
  (_, i) => MIN_FREQUENCY_CAP + i,
);

export function describeFrequencyCap(cap: number): string {
  return cap === 1 ? 'Once per person per day' : `Up to ${cap} times per person per day`;
}

/** Long-form explanation used as helper text wherever the cap can be changed. */
export const FREQUENCY_CAP_HELP =
  'Each viewer can earn from this campaign at most this many times per day (UTC). A low cap spreads your budget across more distinct people and pays for real attention instead of the same viewer replaying the ad to inflate counts. Completions above the cap are never charged.';

export interface FrequencyCapControlProps {
  value: number;
  onChange: (value: number) => void;
  id?: string;
  describedBy?: string;
  invalid?: boolean;
  disabled?: boolean;
}

/** Segmented 1–5 selector for `frequencyCapPerUserPerDay` (arrow keys move the selection like a radio group). */
export function FrequencyCapControl({
  value,
  onChange,
  id,
  describedBy,
  invalid,
  disabled,
}: FrequencyCapControlProps) {
  return (
    <div
      id={id}
      role="radiogroup"
      aria-label="Max views per person per day"
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      className={cn(
        'inline-flex flex-wrap gap-1 rounded-md border bg-surface-muted p-1',
        invalid ? 'border-danger' : 'border-border',
      )}
    >
      {FREQUENCY_CAP_OPTIONS.map((option) => {
        const selected = value === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`${option} ${option === 1 ? 'view' : 'views'} per person per day${
              option === DEFAULT_FREQUENCY_CAP ? ' (recommended)' : ''
            }`}
            data-value={option}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option)}
            onKeyDown={(event) => {
              const delta =
                event.key === 'ArrowRight' || event.key === 'ArrowUp'
                  ? 1
                  : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
                    ? -1
                    : 0;
              if (!delta) return;
              event.preventDefault();
              const next = Math.min(MAX_FREQUENCY_CAP, Math.max(MIN_FREQUENCY_CAP, option + delta));
              onChange(next);
              (
                event.currentTarget.parentElement?.querySelector(
                  `[data-value="${next}"]`,
                ) as HTMLButtonElement | null
              )?.focus();
            }}
            className={cn(
              'relative flex h-11 min-w-11 items-center justify-center rounded-sm px-3 text-sm font-semibold tabular-nums transition-colors',
              selected
                ? 'bg-surface text-primary shadow-soft ring-1 ring-primary/30'
                : 'text-fg-muted hover:bg-surface hover:text-fg',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            {option}
            {option === DEFAULT_FREQUENCY_CAP && (
              <span
                className="absolute -top-1.5 -right-1.5 size-2 rounded-full bg-primary"
                aria-hidden="true"
                title="Recommended"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Compact read-only badge for cards, review and detail pages. */
export function FrequencyCapSummary({ cap, className }: { cap: number; className?: string }) {
  return (
    <Tooltip content={FREQUENCY_CAP_HELP}>
      <span className={cn('inline-flex items-center gap-1.5 text-sm text-fg', className)}>
        <Users className="size-4 text-fg-subtle" aria-hidden="true" />
        <span className="font-semibold tabular-nums">{cap}</span>
        <span className="text-fg-muted">{cap === 1 ? 'view' : 'views'} / person / day</span>
      </span>
    </Tooltip>
  );
}
