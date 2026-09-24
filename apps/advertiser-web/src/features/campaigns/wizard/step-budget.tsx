import { zodResolver } from '@hookform/resolvers/zod';
import { PLATFORM_DEFAULTS } from '@rap/shared';
import { ArrowLeft, ArrowRight, Coins, Info, Users } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/primitives';
import { handleFormError } from '@/lib/forms';
import { computeBudgetSplit } from '@/lib/utils/budget';
import { cn } from '@/lib/utils/cn';
import { formatEtb, formatNumber, formatPercent } from '@/lib/utils/format';
import { budgetSchema, MIN_BUDGET_ETB, MIN_COST_PER_ACTION_ETB, type BudgetValues } from './schemas';

const BUDGET_PRESETS = [1_000, 2_500, 5_000, 10_000];
const COST_PRESETS = [1, 2, 2.5, 5];

export function BudgetStep({
  defaultValues,
  onSubmit,
  onBack,
  saving,
  submitLabel = 'Save draft and continue',
  walletBalanceEtb,
}: {
  defaultValues: Partial<BudgetValues>;
  onSubmit: (values: BudgetValues) => Promise<void> | void;
  onBack: () => void;
  saving?: boolean;
  submitLabel?: string;
  walletBalanceEtb?: number;
}) {
  const form = useForm<BudgetValues>({
    resolver: zodResolver(budgetSchema),
    defaultValues: { budgetEtb: defaultValues.budgetEtb ?? Number.NaN, costPerActionEtb: defaultValues.costPerActionEtb ?? 2 },
    mode: 'onTouched',
  });
  const { register, handleSubmit, formState, control, setValue } = form;
  const budgetEtb = useWatch({ control, name: 'budgetEtb' });
  const costPerActionEtb = useWatch({ control, name: 'costPerActionEtb' });
  const split = computeBudgetSplit(budgetEtb, costPerActionEtb);

  const submit = handleSubmit(async (values) => {
    try {
      await onSubmit(values);
    } catch (error) {
      handleFormError(error, form);
    }
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6" aria-label="Budget and pricing">
      {formState.errors.root?.server && <Alert tone="danger">{formState.errors.root.server.message}</Alert>}

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="flex flex-col gap-6 lg:col-span-3">
          <Field
            label="Total budget"
            required
            error={formState.errors.budgetEtb?.message}
            hint={`Minimum ETB ${MIN_BUDGET_ETB}. Reserved from your wallet when you submit; unspent budget is released when the campaign ends.`}
          >
            {({ id, describedBy, invalid }) => (
              <div className="flex flex-col gap-2">
                <Input
                  id={id}
                  type="number"
                  inputMode="decimal"
                  min={MIN_BUDGET_ETB}
                  step="1"
                  placeholder="5000"
                  leading={<span className="font-medium">ETB</span>}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  className="text-lg font-semibold tabular-nums"
                  autoFocus
                  {...register('budgetEtb', { valueAsNumber: true })}
                />
                <div className="flex flex-wrap gap-2" aria-label="Budget presets">
                  {BUDGET_PRESETS.map((preset) => (
                    <Button
                      key={preset}
                      type="button"
                      variant={budgetEtb === preset ? 'secondary' : 'outline'}
                      size="sm"
                      onClick={() => setValue('budgetEtb', preset, { shouldValidate: true, shouldDirty: true })}
                    >
                      {formatNumber(preset)}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </Field>

          <Field
            label="Cost per verified action"
            required
            error={formState.errors.costPerActionEtb?.message}
            hint={`What you pay each time a viewer completes the action and passes our checks. Minimum ETB ${MIN_COST_PER_ACTION_ETB.toFixed(2)}.`}
          >
            {({ id, describedBy, invalid }) => (
              <div className="flex flex-col gap-2">
                <Input
                  id={id}
                  type="number"
                  inputMode="decimal"
                  min={MIN_COST_PER_ACTION_ETB}
                  step="0.01"
                  placeholder="2.00"
                  leading={<span className="font-medium">ETB</span>}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  className="tabular-nums"
                  {...register('costPerActionEtb', { valueAsNumber: true })}
                />
                <div className="flex flex-wrap gap-2" aria-label="Cost presets">
                  {COST_PRESETS.map((preset) => (
                    <Button
                      key={preset}
                      type="button"
                      variant={costPerActionEtb === preset ? 'secondary' : 'outline'}
                      size="sm"
                      onClick={() => setValue('costPerActionEtb', preset, { shouldValidate: true, shouldDirty: true })}
                    >
                      {preset.toFixed(2)}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </Field>

          {walletBalanceEtb !== undefined && Number.isFinite(budgetEtb) && budgetEtb > walletBalanceEtb && (
            <Alert tone="warning" title="Budget exceeds your wallet balance">
              Your wallet holds {formatEtb(walletBalanceEtb)}. You can save this draft now and add funds before submitting — we will
              guide you through it.
            </Alert>
          )}
        </div>

        <aside className="lg:col-span-2" aria-live="polite">
          <div className="sticky top-24 flex flex-col gap-4 rounded-lg border border-border bg-surface-muted/60 p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
              <Coins className="size-4 text-accent" /> How each action is split
            </h3>
            <SplitBar rewardEtb={split.rewardEtb} feeEtb={split.platformFeeEtb} />
            <dl className="flex flex-col gap-2.5 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-1.5 text-fg-muted">
                  <span className="size-2 rounded-full bg-primary" aria-hidden="true" /> Viewer receives
                  <Tooltip content={`Paid out as coins: ${formatNumber(split.rewardCoins)} coins at ${PLATFORM_DEFAULTS.COINS_PER_ETB} coins per birr.`}>
                    <Info className="size-3.5 text-fg-subtle" aria-label="About coins" />
                  </Tooltip>
                </dt>
                <dd className="font-semibold tabular-nums text-fg">
                  {formatEtb(split.rewardEtb)} <span className="text-xs font-normal text-fg-subtle">({formatNumber(split.rewardCoins)} coins)</span>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-1.5 text-fg-muted">
                  <span className="size-2 rounded-full bg-accent" aria-hidden="true" /> Platform fee ({formatPercent(split.takeRate, 0)})
                </dt>
                <dd className="font-semibold tabular-nums text-fg">{formatEtb(split.platformFeeEtb)}</dd>
              </div>
            </dl>
            <div className="border-t border-border pt-4">
              <p className="flex items-center gap-2 text-sm text-fg-muted">
                <Users className="size-4" /> Estimated verified completions
              </p>
              <p className="text-display mt-1 text-3xl font-bold tracking-tight text-fg tabular-nums">
                {split.estimatedCompletions > 0 ? `≈ ${formatNumber(split.estimatedCompletions)}` : '—'}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-fg-subtle">
                {split.estimatedCompletions > 0
                  ? `${formatEtb(split.totalToUsersEtb)} goes to viewers and ${formatEtb(split.totalPlatformEtb)} to the platform. Flagged or rejected completions are never charged.`
                  : 'Enter a budget and cost per action to see the estimate.'}
              </p>
            </div>
          </div>
        </aside>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="ghost" onClick={onBack} leadingIcon={<ArrowLeft className="size-4" />}>
          Back
        </Button>
        <Button type="submit" size="lg" loading={saving || formState.isSubmitting} trailingIcon={<ArrowRight className="size-4" />}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function SplitBar({ rewardEtb, feeEtb }: { rewardEtb: number; feeEtb: number }) {
  const total = rewardEtb + feeEtb;
  const rewardShare = total > 0 ? rewardEtb / total : 0.5;
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full bg-border" aria-hidden="true">
      <div className={cn('h-full bg-primary transition-[width] duration-500')} style={{ width: `${rewardShare * 100}%` }} />
      <div className="h-full flex-1 bg-accent transition-[width] duration-500" />
    </div>
  );
}
