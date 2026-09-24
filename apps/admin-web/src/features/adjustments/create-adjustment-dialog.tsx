import { zodResolver } from '@hookform/resolvers/zod';
import { type AdminUserListItem, coinsToEtb, type CreateCoinAdjustmentDto } from '@rap/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Minus, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { adjustmentsApi, homeApi } from '@/lib/api/endpoints';
import { applyFieldErrors, describeError, isApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { cn } from '@/lib/utils/cn';
import { formatCoins, formatEtb } from '@/lib/utils/format';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { UserPicker } from './user-picker';

const schema = z.object({
  user: z.custom<AdminUserListItem>((v) => Boolean(v && typeof v === 'object' && 'id' in v), { message: 'Pick the user to adjust.' }),
  direction: z.enum(['credit', 'deduct']),
  amount: z.coerce.number<number>().int('Coins are whole numbers.').positive('Enter an amount greater than zero.').max(1_000_000, 'Maximum 1,000,000 coins.'),
  reason: z.string().trim().min(5, 'Give a reason of at least 5 characters.').max(1000),
  reference: z.string().trim().max(120, 'Maximum 120 characters.').optional(),
});
type FormValues = z.infer<typeof schema>;

export interface CreateAdjustmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (id: string) => void;
}

/** Step 1 of the two-step workflow: nothing is credited until a DIFFERENT admin approves. */
export function CreateAdjustmentDialog({ open, onOpenChange, onCreated }: CreateAdjustmentDialogProps) {
  const queryClient = useQueryClient();
  const config = useQuery({ queryKey: queryKeys.config, queryFn: homeApi.config, staleTime: 5 * 60_000 });
  const coinsPerEtb = config.data?.coinsPerEtb ?? 100;
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { user: undefined as unknown as AdminUserListItem, direction: 'credit', amount: undefined as unknown as number, reason: '', reference: '' },
  });

  useEffect(() => {
    if (!open) {
      form.reset();
      setFormError(null);
    }
  }, [open, form]);

  const create = useMutation({
    mutationFn: (dto: CreateCoinAdjustmentDto) => adjustmentsApi.create(dto),
    onSuccess: (res) => {
      toast.success('Adjustment requested', { description: 'A different finance or super admin must approve it before anything is credited.' });
      void queryClient.invalidateQueries({ queryKey: ['adjustments'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
      onOpenChange(false);
      onCreated?.(res.id);
    },
    onError: (err) => {
      if (isApiError(err) && err.code === 'VALIDATION_ERROR') {
        const applied = applyFieldErrors(err, (name, e) => form.setError(name as keyof FormValues, e), ['userId', 'amount', 'reason', 'reference']);
        if (applied.includes('userId')) form.setError('user', { type: 'server', message: 'Invalid user.' });
        if (applied.length) return;
      }
      if (isApiError(err) && err.code === 'INSUFFICIENT_BALANCE') {
        const bal = (err.details as { coinBalance?: number } | undefined)?.coinBalance;
        form.setError('amount', { type: 'server', message: `Deduction exceeds the user’s balance${bal !== undefined ? ` (${formatCoins(bal)} coins)` : ''}.` });
        return;
      }
      setFormError(describeError(err));
    },
  });

  const direction = form.watch('direction');
  const rawAmount = form.watch('amount');
  const amount = Number.isFinite(Number(rawAmount)) ? Math.trunc(Number(rawAmount)) : 0;
  const signed = direction === 'deduct' ? -amount : amount;
  const user = form.watch('user') as AdminUserListItem | undefined;
  const balanceAfter = user ? user.coinBalance + signed : null;

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    create.mutate({
      userId: values.user.id,
      amount: values.direction === 'deduct' ? -values.amount : values.amount,
      reason: values.reason,
      reference: values.reference || undefined,
    });
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      locked={create.isPending}
      title="Request a coin adjustment"
      description="Step 1 of 2. The ledger is only written when a different admin approves this request."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="create-adjustment-form" loading={create.isPending}>
            Submit for approval
          </Button>
        </>
      }
    >
      <form id="create-adjustment-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {formError ? (
          <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs">
            {formError}
          </div>
        ) : null}

        <Field label="User" required error={form.formState.errors.user?.message as string | undefined}>
          {(id, describedBy) => (
            <Controller
              control={form.control}
              name="user"
              render={({ field }) => <UserPicker id={id} describedBy={describedBy} value={(field.value as AdminUserListItem | undefined) ?? null} onChange={(u) => field.onChange(u)} invalid={Boolean(form.formState.errors.user)} />}
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
          <Field label="Direction" required>
            {() => (
              <Controller
                control={form.control}
                name="direction"
                render={({ field }) => (
                  <div role="radiogroup" aria-label="Direction" className="inline-flex h-8 rounded-md border bg-sunken p-0.5">
                    {(['credit', 'deduct'] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        role="radio"
                        aria-checked={field.value === d}
                        onClick={() => field.onChange(d)}
                        className={cn(
                          'inline-flex h-7 items-center gap-1 rounded-[5px] px-3 text-xs font-medium transition-colors',
                          field.value === d ? (d === 'credit' ? 'bg-surface text-success shadow-xs' : 'bg-surface text-danger shadow-xs') : 'text-fg-muted hover:text-fg',
                        )}
                      >
                        {d === 'credit' ? <Plus className="size-3" /> : <Minus className="size-3" />}
                        {d === 'credit' ? 'Credit' : 'Deduct'}
                      </button>
                    ))}
                  </div>
                )}
              />
            )}
          </Field>
          <Field
            label="Coins"
            required
            error={form.formState.errors.amount?.message}
            hint={
              amount > 0 ? (
                <>
                  = {formatEtb(coinsToEtb(amount, coinsPerEtb))}
                  {balanceAfter !== null ? (
                    <>
                      {' '}
                      · balance after: <span className={cn('tabular font-medium', balanceAfter < 0 ? 'text-danger' : 'text-fg')}>{formatCoins(balanceAfter)}</span>
                    </>
                  ) : null}
                </>
              ) : (
                `Whole coins. ${coinsPerEtb} coins = ETB 1.00`
              )
            }
          >
            {(id, describedBy) => (
              <Input id={id} type="number" inputMode="numeric" step={1} min={1} placeholder="500" aria-describedby={describedBy} invalid={Boolean(form.formState.errors.amount)} className="tabular" {...form.register('amount')} />
            )}
          </Field>
        </div>

        <Field label="Reason" required error={form.formState.errors.reason?.message} hint="Shown to the user in their notification and stored in the ledger + audit log.">
          {(id, describedBy) => <Textarea id={id} rows={3} maxLength={1000} placeholder="e.g. Goodwill credit for failed video playback (ticket #452)" aria-describedby={describedBy} invalid={Boolean(form.formState.errors.reason)} {...form.register('reason')} />}
        </Field>

        <Field label="Reference" error={form.formState.errors.reference?.message} hint="Optional ticket / case id.">
          {(id, describedBy) => <Input id={id} maxLength={120} placeholder="TICKET-452" aria-describedby={describedBy} className="font-mono" {...form.register('reference')} />}
        </Field>

        {amount > 0 && user ? (
          <div className={cn('rounded-md border px-3 py-2 text-sm', direction === 'credit' ? 'border-success/40 bg-success/8' : 'border-danger/40 bg-danger/8')}>
            <span className="font-medium">{direction === 'credit' ? 'Credit' : 'Deduct'}</span> {formatCoins(amount)} coins ({formatEtb(coinsToEtb(amount, coinsPerEtb))}) {direction === 'credit' ? 'to' : 'from'}{' '}
            <span className="font-medium">{user.fullName ?? user.phoneNumber}</span> - pending a second admin’s approval.
          </div>
        ) : null}
      </form>
    </Dialog>
  );
}
