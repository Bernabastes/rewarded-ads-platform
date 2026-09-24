import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowUpRight, Wallet } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { env } from '@/config/env';
import { handleFormError } from '@/lib/forms';
import { formatEtb, formatNumber } from '@/lib/utils/format';
import { useCreateTopup } from './hooks';
import { topupContextStore } from './topup-context';

export const MIN_TOPUP_ETB = 100;
export const TOPUP_PRESETS = [500, 1_000, 2_500, 5_000, 10_000];

const schema = z.object({
  amountEtb: z
    .number({ error: 'Enter an amount' })
    .min(MIN_TOPUP_ETB, `The minimum top-up is ETB ${MIN_TOPUP_ETB}`)
    .max(10_000_000, 'That amount is above the platform maximum')
    .refine((v) => Math.round(v * 100) === v * 100, 'Use at most two decimals'),
});

type TopupValues = z.infer<typeof schema>;

export interface TopupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-filled amount (e.g. the shortfall for a campaign budget). */
  suggestedAmountEtb?: number;
  /** Where to send the advertiser after the payment settles. */
  returnTo?: string;
  returnLabel?: string;
  /** Test seam: replace the browser redirect. */
  redirect?: (url: string) => void;
}

export function TopupDialog({ open, onOpenChange, suggestedAmountEtb, returnTo, returnLabel, redirect }: TopupDialogProps) {
  const createTopup = useCreateTopup();
  const form = useForm<TopupValues>({
    resolver: zodResolver(schema),
    defaultValues: { amountEtb: suggestedAmountEtb ?? 1_000 },
    mode: 'onTouched',
  });
  const { register, handleSubmit, formState, control, setValue } = form;
  const amount = useWatch({ control, name: 'amountEtb' });

  const submit = handleSubmit(async (values) => {
    try {
      const returnUrl = `${env.publicUrl}/billing/return`;
      const topup = await createTopup.mutateAsync({ amountEtb: values.amountEtb, returnUrl });
      topupContextStore.save({ paymentId: topup.paymentId, txRef: topup.txRef, amountEtb: topup.amountEtb, returnTo, returnLabel });
      (redirect ?? ((url: string) => window.location.assign(url)))(topup.checkoutUrl);
    } catch (error) {
      handleFormError(error, form);
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !createTopup.isPending && onOpenChange(next)}>
      <DialogContent
        title="Add funds to your wallet"
        description="You will be taken to our payment partner (Chapa) to complete the payment, then brought straight back."
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={createTopup.isPending}>
              Cancel
            </Button>
            <Button form="topup-form" type="submit" loading={createTopup.isPending || formState.isSubmitting} trailingIcon={<ArrowUpRight className="size-4" />}>
              Continue to payment{Number.isFinite(amount) && amount >= MIN_TOPUP_ETB ? ` · ${formatEtb(amount)}` : ''}
            </Button>
          </>
        }
      >
        <form id="topup-form" onSubmit={submit} noValidate className="flex flex-col gap-5">
          {formState.errors.root?.server && <Alert tone="danger">{formState.errors.root.server.message}</Alert>}
          <div className="flex flex-wrap gap-2" role="group" aria-label="Amount presets">
            {TOPUP_PRESETS.map((preset) => (
              <Button key={preset} type="button" size="sm" variant={amount === preset ? 'secondary' : 'outline'} onClick={() => setValue('amountEtb', preset, { shouldValidate: true })}>
                {formatNumber(preset)}
              </Button>
            ))}
          </div>
          <Field label="Amount" required error={formState.errors.amountEtb?.message} hint={`Minimum ETB ${MIN_TOPUP_ETB}. Funds are available as soon as the payment is confirmed.`}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="number"
                inputMode="decimal"
                min={MIN_TOPUP_ETB}
                step="1"
                leading={<span className="font-medium">ETB</span>}
                className="text-lg font-semibold tabular-nums"
                aria-describedby={describedBy}
                invalid={invalid}
                autoFocus
                {...register('amountEtb', { valueAsNumber: true })}
              />
            )}
          </Field>
          <div className="flex gap-3 rounded-md bg-surface-muted p-3 text-sm text-fg-muted">
            <Wallet className="mt-0.5 size-4 shrink-0 text-primary" />
            <p>
              Payments are processed by a licensed gateway; we never hold your card details. An invoice is issued automatically for every
              successful top-up.
            </p>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
