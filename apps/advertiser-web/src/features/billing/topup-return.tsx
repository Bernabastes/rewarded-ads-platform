import type { PaymentItem } from '@rap/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, Clock, FileText, FlaskConical, RefreshCw, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { billingApi } from '@/lib/api';
import { toastApiError } from '@/lib/forms';
import { queryKeys } from '@/lib/query/keys';
import { formatDateTime, formatEtb } from '@/lib/utils/format';
import { useInvalidateBilling, useInvoices } from './hooks';
import { topupContextStore, type TopupContext } from './topup-context';

/** The API marks mock-gateway payments with `mock: true` (not yet part of the shared contract). */
export function isMockPayment(payment: PaymentItem): boolean {
  return (payment as PaymentItem & { mock?: boolean }).mock === true;
}

export interface ReturnParams {
  txRef: string | null;
  paymentId: string | null;
}

/** Parse every reference the gateway (or our mock) might send back. */
export function parseReturnParams(search: URLSearchParams): ReturnParams {
  const topup = search.get('topup');
  const txRef = search.get('txRef') ?? search.get('tx_ref') ?? search.get('trx_ref') ?? (topup && topup !== 'start' ? topup : null);
  return { txRef, paymentId: search.get('paymentId') ?? search.get('payment_id') };
}

const POLL_INTERVAL_MS = 2_500;
const POLL_TIMEOUT_MS = 3 * 60_000;

/**
 * Landing panel after checkout: resolves the payment (context → detail endpoint, or search the payment list by
 * txRef), polls until it leaves `pending`, then shows a receipt with the invoice link and a return action.
 */
export function TopupReturnPanel({ params, onDone }: { params: ReturnParams; onDone: () => void }) {
  // Captured once: the stored context is cleared on settlement but the receipt still needs the return action.
  const [context] = useState<TopupContext | null>(() =>
    params.txRef ? topupContextStore.get(params.txRef) : topupContextStore.latest(),
  );
  const paymentId = params.paymentId ?? context?.paymentId ?? null;
  const startedAt = useRef<number | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const invalidate = useInvalidateBilling();

  useEffect(() => {
    startedAt.current ??= Date.now();
  }, []);

  const payment = useQuery({
    queryKey: [...queryKeys.billing.payment(paymentId ?? params.txRef ?? 'unknown'), 'return'],
    queryFn: async (): Promise<PaymentItem | null> => {
      if (paymentId) return billingApi.payment(paymentId);
      if (params.txRef) {
        const page = await billingApi.payments({ page: 1, limit: 50 });
        return page.data.find((p) => p.txRef === params.txRef) ?? null;
      }
      return null;
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data && data.status !== 'pending') return false;
      if (Date.now() - (startedAt.current ?? Date.now()) > POLL_TIMEOUT_MS) return false;
      return POLL_INTERVAL_MS;
    },
  });

  const settled = payment.data && payment.data.status !== 'pending';
  const txRef = params.txRef;
  const settleMock = useMutation({
    mutationFn: (ref: string) => billingApi.mockCheckoutPay(ref, 'success'),
    onSuccess: () => void payment.refetch(),
    onError: toastApiError,
  });

  useEffect(() => {
    if (!settled) return;
    void invalidate();
    if (txRef) topupContextStore.remove(txRef);
  }, [settled, invalidate, txRef]);

  useEffect(() => {
    if (settled || payment.isError) return;
    const timer = window.setTimeout(() => setTimedOut(true), POLL_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [settled, payment.isError]);

  if (payment.isPending) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <Skeleton className="size-14 rounded-full" />
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-72" />
        </CardContent>
      </Card>
    );
  }

  if (payment.isError || !payment.data) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-warning/15 text-warning">
            <Clock className="size-7" />
          </span>
          <h2 className="text-display text-xl font-semibold text-fg">We could not match this payment yet</h2>
          <p className="max-w-md text-sm text-fg-muted">
            If you completed the payment, it will appear in your history within a minute. Your wallet balance updates automatically.
          </p>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => void payment.refetch()} leadingIcon={<RefreshCw className="size-4" />}>
              Check again
            </Button>
            <Button onClick={onDone}>Back to billing</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const data = payment.data;

  if (data.status === 'pending') {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center" aria-live="polite">
          <span className="relative flex size-14 items-center justify-center rounded-full bg-primary-soft text-primary">
            <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" aria-hidden="true" />
            <Clock className="size-7" />
          </span>
          <h2 className="text-display text-xl font-semibold text-fg">{timedOut ? 'Still waiting for the gateway' : 'Confirming your payment…'}</h2>
          <p className="max-w-md text-sm text-fg-muted">
            {timedOut
              ? 'The payment provider has not confirmed yet. You can keep this page open, come back later, or resume the checkout.'
              : `We are waiting for the payment provider to confirm ${formatEtb(data.amountEtb)} (reference ${data.txRef}). This usually takes a few seconds.`}
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {isMockPayment(data) ? (
              <Button
                variant="outline"
                loading={settleMock.isPending}
                onClick={() => settleMock.mutate(data.txRef)}
                leadingIcon={<FlaskConical className="size-4" />}
              >
                Complete test payment
              </Button>
            ) : (
              data.checkoutUrl && (
                <Button asChild variant="outline">
                  <a href={data.checkoutUrl}>Resume checkout</a>
                </Button>
              )
            )}
            <Button variant="ghost" onClick={onDone}>
              Back to billing
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (data.status === 'completed') return <Receipt payment={data} context={context} onDone={onDone} />;

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-danger/10 text-danger">
          <XCircle className="size-7" />
        </span>
        <h2 className="text-display text-xl font-semibold text-fg">Payment {data.status === 'failed' ? 'failed' : 'cancelled'}</h2>
        <p className="max-w-md text-sm text-fg-muted">
          {formatEtb(data.amountEtb)} was not charged (reference {data.txRef}). Nothing was added to your wallet — you can try again with a new top-up.
        </p>
        <div className="flex gap-3">
          <Button asChild>
            <Link to="/billing?topup=start">Try again</Link>
          </Button>
          <Button variant="ghost" onClick={onDone}>
            Back to billing
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Receipt({ payment, context, onDone }: { payment: PaymentItem; context: TopupContext | null; onDone: () => void }) {
  const invoices = useInvoices(1, 20);
  const invoice = invoices.data?.data.find((inv) => inv.paymentId === payment.id);
  return (
    <Card className="overflow-hidden">
      <div className="h-1.5 bg-success" aria-hidden="true" />
      <CardContent className="flex flex-col items-center gap-5 py-10 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-success/12 text-success">
          <CheckCircle2 className="size-8" />
        </span>
        <div>
          <h2 className="text-display text-2xl font-bold text-fg">Payment received</h2>
          <p className="mt-1 text-sm text-fg-muted">Your wallet has been credited and an invoice was issued.</p>
        </div>
        <dl className="grid w-full max-w-md gap-3 rounded-md border border-border bg-surface-muted/60 p-4 text-left text-sm sm:grid-cols-2">
          <div>
            <dt className="text-fg-subtle">Amount</dt>
            <dd className="text-display text-xl font-bold text-fg tabular-nums">{formatEtb(payment.amountEtb)}</dd>
          </div>
          <div>
            <dt className="text-fg-subtle">Paid</dt>
            <dd className="font-medium text-fg">{formatDateTime(payment.paidAt ?? payment.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-fg-subtle">Reference</dt>
            <dd className="font-medium text-fg">{payment.txRef}</dd>
          </div>
          <div>
            <dt className="text-fg-subtle">Gateway</dt>
            <dd className="font-medium text-fg capitalize">
              {payment.gateway}
              {payment.gatewayReference ? ` · ${payment.gatewayReference}` : ''}
            </dd>
          </div>
        </dl>
        <div className="flex flex-wrap justify-center gap-3">
          {invoice && (
            <Button asChild variant="outline">
              <Link to={`/billing/invoices/${invoice.id}`}>
                <FileText className="size-4" /> View invoice {invoice.invoiceNumber}
              </Link>
            </Button>
          )}
          {context?.returnTo ? (
            <Button asChild>
              <Link to={context.returnTo}>
                {context.returnLabel ?? 'Continue'} <ArrowRight className="size-4" />
              </Link>
            </Button>
          ) : (
            <Button onClick={onDone}>Done</Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
