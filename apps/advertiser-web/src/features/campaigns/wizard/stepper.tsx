import { Check } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import {
  canNavigateTo,
  STEP_META,
  stepIndex,
  WIZARD_STEPS,
  type WizardState,
  type WizardStep,
} from './machine';

export function WizardStepper({
  state,
  onSelect,
}: {
  state: WizardState;
  onSelect: (step: WizardStep) => void;
}) {
  const currentIndex = stepIndex(state.step);
  return (
    <nav aria-label="Campaign setup progress">
      <ol className="grid grid-cols-4 gap-2">
        {WIZARD_STEPS.map((step, index) => {
          const complete = state.completed.includes(step) && index !== currentIndex;
          const current = index === currentIndex;
          const reachable = canNavigateTo(state, step);
          return (
            <li key={step} className="min-w-0">
              <button
                type="button"
                onClick={() => reachable && onSelect(step)}
                disabled={!reachable}
                aria-current={current ? 'step' : undefined}
                className={cn(
                  'flex w-full flex-col gap-2 rounded-md px-1 py-2 text-left transition-colors disabled:cursor-not-allowed',
                  reachable && !current && 'hover:bg-surface-muted',
                )}
              >
                <span
                  className={cn(
                    'h-1.5 w-full rounded-full transition-colors',
                    current ? 'bg-primary' : complete ? 'bg-primary/60' : 'bg-border',
                  )}
                  aria-hidden="true"
                />
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      'flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                      current
                        ? 'bg-primary text-primary-fg'
                        : complete
                          ? 'bg-primary-soft text-primary'
                          : 'bg-surface-muted text-fg-subtle',
                    )}
                  >
                    {complete ? <Check className="size-3.5" /> : index + 1}
                  </span>
                  <span
                    className={cn(
                      'truncate text-sm font-medium',
                      current ? 'text-fg' : reachable ? 'text-fg-muted' : 'text-fg-subtle',
                    )}
                  >
                    <span className="hidden sm:inline">{STEP_META[step].short}</span>
                    <span className="sm:hidden">{index + 1}</span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
