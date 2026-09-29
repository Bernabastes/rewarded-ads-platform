import { zodResolver } from '@hookform/resolvers/zod';
import { ErrorCode, type CreateTopupDto, type TopupResponse } from '@rap/shared';
import { useMutation } from '@tanstack/react-query';
import { ArrowUpRight, ExternalLink, FlaskConical, Loader2, Wallet } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { env } from '@/config/env';
import { billingApi } from '@/lib/api';
import { isApiError } from '@/lib/api/errors';
import { handleFormError, toastApiError } from '@/lib/forms';
import { formatEtb, formatNumber } from '@/lib/utils/format';
import { useCreateTopup } from './hooks';
import { newIdempotencyKey } from './idempotent-topup';
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
  /** Test seam: replace the browser redirect used for real gateways. */
  redirect?: (url: string) => void;
}

/** Return-route URL the gateway (or our mock fallback) lands on. */
export function topupReturnPath(txRef: string): string {
  return `/billing?topup=${encodeURIComponent(txRef)}`;
}

export function TopupDialog({
  open,
  onOpenChange,
  suggestedAmountEtb,
  returnTo,
  returnLabel,
  redirect,
}: TopupDialogProps) {
  const createTopup = useCreateTopup();
  const navigate = useNavigate();
  const [mockTopup, setMockTopup] = useState<TopupResponse | null>(null);
  const [waitingForPrevious, setWaitingForPrevious] = useState(false);
  /**
   * One `Idempotency-Key` per intent: minted the first time "Continue" is pressed for a given payload and reused
   * on retries of that same payload (double click, flaky network), so the API replays the payment instead of
   * creating a second one. A different amount is a new intent and gets a new key.
   */
  const intent = useRef<{ key: string; fingerprint: string } | null>(null);
  const form = useForm<TopupValues>({
    resolver: zodResolver(schema),
    defaultValues: { amountEtb: suggestedAmountEtb ?? 1_000 },
    mode: 'onTouched',
  });
  const { register, handleSubmit, formState, control, setValue } = form;
  const amount = useWatch({ control, name: 'amountEtb' });

  const settleMock = useMutation({
    mutationFn: ({ txRef, outcome }: { txRef: string; outcome: 'success' | 'failed' }) =>
      billingApi.mockCheckoutPay(txRef, outcome),
    onSuccess: (_data, vars) => {
      setMockTopup(null);
      onOpenChange(false);
      navigate(topupReturnPath(vars.txRef));
    },
    onError: toastApiError,
  });

  const onValid = async (values: TopupValues) => {
    setWaitingForPrevious(false);
    const dto: CreateTopupDto = { amountEtb: values.amountEtb, returnUrl: `${env.publicUrl}/billing/return` };
    const fingerprint = JSON.stringify(dto);
    if (!intent.current || intent.current.fingerprint !== fingerprint) {
      intent.current = { key: newIdempotencyKey(), fingerprint };
    }
    try {
      const topup = await createTopup.mutateAsync({
        dto,
        idempotencyKey: intent.current.key,
        onPoll: () => setWaitingForPrevious(true),
      });
      intent.current = null;
      setWaitingForPrevious(false);
      topupContextStore.save({
        paymentId: topup.paymentId,
        txRef: topup.txRef,
        amountEtb: topup.amountEtb,
        returnTo,
        returnLabel,
      });
      if (topup.mock) {
        // The hosted mock page cannot run its inline script under the API's CSP, so test payments settle in-app.
        setMockTopup(topup);
        return;
      }
      (redirect ?? ((url: string) => window.location.assign(url)))(topup.checkoutUrl);
    } catch (error) {
      setWaitingForPrevious(false);
      // A payload mismatch under an old key is a client bug; start a fresh intent for the next attempt.
      if (isApiError(error) && error.code === ErrorCode.IDEMPOTENCY_KEY_REUSED) intent.current = null;
      handleFormError(error, form);
    }
  };

  // Call handleSubmit inside the event so the validated callback (which touches refs) never runs during render.
  const submit = (event: FormEvent<HTMLFormElement>) => void handleSubmit(onValid)(event);

  const busy = createTopup.isPending || formState.isSubmitting || settleMock.isPending;

  const close = (next: boolean) => {
    if (busy) return;
    if (!next) setMockTopup(null);
    onOpenChange(next);
  };

  if (mockTopup) {
    return (
      <Dialog open={open} onOpenChange={close}>
        <DialogContent
          title={
            <span className="flex items-center gap-2">
              Test payment <Badge tone="warning">Mock gateway</Badge>
            </span>
          }
          description="The API is running without live Chapa credentials, so this simulates the hosted checkout. No real money moves."
          footer={
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => settleMock.mutate({ txRef: mockTopup.txRef, outcome: 'failed' })}
              >
                Simulate failure
              </Button>
              <Button
                loading={settleMock.isPending}
                onClick={() => settleMock.mutate({ txRef: mockTopup.txRef, outcome: 'success' })}
                leadingIcon={<FlaskConical className="size-4" />}
              >
                Pay {formatEtb(mockTopup.amountEtb)} (test)
              </Button>
            </>
          }
        >
          <dl className="grid gap-3 rounded-md bg-surface-muted p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-fg-subtle">Amount</dt>
              <dd className="text-display text-xl font-bold text-fg tabular-nums">
                {formatEtb(mockTopup.amountEtb)}
              </dd>
            </div>
            <div>
              <dt className="text-fg-subtle">Reference</dt>
              <dd className="font-medium text-fg">{mockTopup.txRef}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-fg-subtle">
            Prefer the hosted page?{' '}
            <a
              href={mockTopup.checkoutUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
            >
              Open mock checkout <ExternalLink className="size-3" />
            </a>{' '}
            (its inline script is currently blocked by the API's content-security policy).
          </p>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        title="Add funds to your wallet"
        description="You will be taken to our payment partner (Chapa) to complete the payment, then brought straight back."
        footer={
          <>
            <Button variant="outline" onClick={() => close(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              form="topup-form"
              type="submit"
              loading={busy}
              trailingIcon={<ArrowUpRight className="size-4" />}
            >
              Continue to payment
              {Number.isFinite(amount) && amount >= MIN_TOPUP_ETB ? ` · ${formatEtb(amount)}` : ''}
            </Button>
          </>
        }
      >
        <form id="topup-form" onSubmit={submit} noValidate className="flex flex-col gap-5">
          {formState.errors.root?.server && (
            <Alert tone="danger">{formState.errors.root.server.message}</Alert>
          )}
          <div className="flex flex-wrap gap-2" role="group" aria-label="Amount presets">
            {TOPUP_PRESETS.map((preset) => (
              <Button
                key={preset}
                type="button"
                size="sm"
                variant={amount === preset ? 'secondary' : 'outline'}
                onClick={() => setValue('amountEtb', preset, { shouldValidate: true })}
              >
                {formatNumber(preset)}
              </Button>
            ))}
          </div>
          <Field
            label="Amount"
            required
            error={formState.errors.amountEtb?.message}
            hint={`Minimum ETB ${MIN_TOPUP_ETB}. Funds are available as soon as the payment is confirmed.`}
          >
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
              Payments are processed by a licensed gateway; we never hold your card details. An invoice is
              issued automatically for every successful top-up.
            </p>
          </div>
          {waitingForPrevious && (
            <p
              className="flex items-center gap-2 text-sm text-fg-muted"
              role="status"
              data-testid="topup-waiting"
            >
              <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
              Your previous request is still being confirmed — waiting for it instead of charging twice.
            </p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
