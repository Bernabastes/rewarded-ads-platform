import type { AdvertiserLedgerEntryType } from '@rap/shared';
import { useMutation } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, ExternalLink, FileText, Plus, RefreshCw, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { WalletIllustration } from '@/components/feedback/illustrations';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { VerificationBanner } from '@/components/layout/verification-banner';
import { CountUp } from '@/components/motion/count-up';
import { PageTransition, Stagger, StaggerItem } from '@/components/motion/motion';
import { InvoiceStatusBadge, PaymentStatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger, Tooltip } from '@/components/ui/primitives';
import { Skeleton, TableSkeleton } from '@/components/ui/skeleton';
import {
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { billingApi } from '@/lib/api';
import { toastApiError } from '@/lib/forms';
import { cn } from '@/lib/utils/cn';
import { formatDateTime, formatEtb, humanize } from '@/lib/utils/format';
import { useInvoices, useLedger, usePayments, useWalletBalance } from './hooks';
import { TopupDialog, topupReturnPath } from './topup-dialog';
import { isMockPayment, parseReturnParams, TopupReturnPanel } from './topup-return';

const LEDGER_LABEL: Record<AdvertiserLedgerEntryType, string> = {
  topup: 'Top-up',
  campaign_budget_reservation: 'Budget reserved',
  campaign_budget_refund: 'Budget released',
  adjustment: 'Adjustment',
};

export function BillingPage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const wallet = useWalletBalance();

  const isReturn =
    location.pathname.endsWith('/return') ||
    (params.get('topup') !== null && params.get('topup') !== 'start');
  const returnParams = parseReturnParams(params);
  const startTopup = params.get('topup') === 'start';
  const suggested = Number(params.get('amount'));
  const returnTo = params.get('returnTo') ?? undefined;
  const returnLabel = params.get('returnLabel') ?? undefined;
  const [dialogOpen, setDialogOpen] = useState(false);
  const topupOpen = dialogOpen || startTopup;

  const closeTopup = () => {
    setDialogOpen(false);
    if (startTopup) {
      const next = new URLSearchParams(params);
      for (const key of ['topup', 'amount', 'returnTo', 'returnLabel']) next.delete(key);
      setParams(next, { replace: true });
    }
  };

  const finishReturn = () => navigate('/billing', { replace: true });

  return (
    <PageTransition className="flex flex-col gap-6">
      <PageHeader
        title="Billing"
        description="Your advertising wallet, payments and invoices. Budgets are reserved from the wallet when a campaign is submitted and released if it is rejected or ends early."
        actions={
          <Button onClick={() => setDialogOpen(true)} leadingIcon={<Plus className="size-4" />}>
            Add funds
          </Button>
        }
      />
      <VerificationBanner />

      {isReturn && (
        <TopupReturnPanel
          key={`${returnParams.txRef}-${returnParams.paymentId}`}
          params={returnParams}
          onDone={finishReturn}
        />
      )}

      <Stagger className="grid gap-4 lg:grid-cols-3">
        <StaggerItem className="lg:col-span-2">
          <Card className="relative h-full overflow-hidden bg-forest-800 text-forest-50 dark:bg-forest-900">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{
                background: 'radial-gradient(70% 60% at 100% 0%, rgb(230 123 65 / 0.35), transparent 60%)',
              }}
            />
            <CardContent className="relative flex h-full flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="flex items-center gap-2 text-sm text-forest-100">
                  <Wallet className="size-4" /> Available balance
                </p>
                {wallet.isPending ? (
                  <Skeleton className="mt-2 h-10 w-48 bg-forest-700" />
                ) : wallet.isError ? (
                  <p className="mt-2 text-sm text-forest-100">Balance unavailable</p>
                ) : (
                  <p className="text-display mt-1 text-4xl font-bold tracking-tight">
                    <CountUp value={wallet.data.balanceEtb} format={formatEtb} />
                  </p>
                )}
                {wallet.data && (
                  <p className="mt-2 text-sm text-forest-100/85">
                    {formatEtb(wallet.data.reservedEtb)} reserved by campaigns in review or running.
                  </p>
                )}
              </div>
              {wallet.data && (
                <dl className="grid grid-cols-2 gap-4 text-sm sm:text-right">
                  <div>
                    <dt className="text-forest-200">Lifetime top-ups</dt>
                    <dd className="font-semibold tabular-nums">{formatEtb(wallet.data.lifetimeTopupsEtb)}</dd>
                  </div>
                  <div>
                    <dt className="text-forest-200">Lifetime spend</dt>
                    <dd className="font-semibold tabular-nums">{formatEtb(wallet.data.lifetimeSpendEtb)}</dd>
                  </div>
                </dl>
              )}
            </CardContent>
          </Card>
        </StaggerItem>
        <StaggerItem>
          <Card className="h-full">
            <CardHeader title="How billing works" />
            <CardContent className="flex flex-col gap-3 pt-0 text-sm text-fg-muted">
              <p>
                <strong className="font-medium text-fg">1. Add funds</strong> via Chapa — telebirr, CBE Birr,
                cards and bank transfer.
              </p>
              <p>
                <strong className="font-medium text-fg">2. Submit a campaign</strong> — its budget is reserved
                so approved ads can go live at once.
              </p>
              <p>
                <strong className="font-medium text-fg">3. Pay per verified completion</strong> — flagged or
                rejected views are never charged; unspent budget flows back.
              </p>
            </CardContent>
          </Card>
        </StaggerItem>
      </Stagger>

      <Tabs defaultValue="payments">
        <TabsList aria-label="Billing records">
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="ledger">Wallet activity</TabsTrigger>
        </TabsList>
        <TabsContent value="payments" className="mt-4 outline-none">
          <PaymentsTable onTopup={() => setDialogOpen(true)} />
        </TabsContent>
        <TabsContent value="invoices" className="mt-4 outline-none">
          <InvoicesTable />
        </TabsContent>
        <TabsContent value="ledger" className="mt-4 outline-none">
          <LedgerTable />
        </TabsContent>
      </Tabs>

      <TopupDialog
        open={topupOpen}
        onOpenChange={(open) => (open ? setDialogOpen(true) : closeTopup())}
        suggestedAmountEtb={Number.isFinite(suggested) && suggested >= 100 ? suggested : undefined}
        returnTo={returnTo}
        returnLabel={returnLabel}
      />
    </PageTransition>
  );
}

function PaymentsTable({ onTopup }: { onTopup: () => void }) {
  const [page, setPage] = useState(1);
  const payments = usePayments(page);
  const navigate = useNavigate();
  const settleMock = useMutation({
    mutationFn: (txRef: string) => billingApi.mockCheckoutPay(txRef, 'success'),
    onSuccess: (_data, txRef) => navigate(topupReturnPath(txRef)),
    onError: toastApiError,
  });
  return (
    <Card>
      <CardHeader
        title="Payment history"
        description="Every top-up attempt, including pending and failed ones."
        action={<RefreshButton onClick={() => void payments.refetch()} loading={payments.isFetching} />}
      />
      {payments.isPending ? (
        <TableSkeleton rows={4} columns={5} />
      ) : payments.isError ? (
        <ErrorState compact error={payments.error} onRetry={() => void payments.refetch()} />
      ) : payments.data.data.length === 0 ? (
        <EmptyState
          compact
          illustration={<WalletIllustration className="h-auto w-full" />}
          title="No payments yet"
          description="Add funds to reserve budgets for your campaigns."
          action={<Button onClick={onTopup}>Add funds</Button>}
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Status</TableHead>
                <TableHead numeric>Amount</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.data.data.map((payment) => (
                <TableRow key={payment.id}>
                  <TableCell className="whitespace-nowrap text-fg-muted">
                    {formatDateTime(payment.paidAt ?? payment.createdAt)}
                  </TableCell>
                  <TableCell>
                    <span className="font-medium text-fg">{payment.txRef}</span>
                    <span className="block text-xs text-fg-subtle capitalize">{payment.gateway}</span>
                  </TableCell>
                  <TableCell>
                    <PaymentStatusBadge status={payment.status} />
                  </TableCell>
                  <TableCell numeric className="font-semibold">
                    {formatEtb(payment.amountEtb)}
                  </TableCell>
                  <TableCell className="text-right">
                    {payment.status === 'pending' ? (
                      <div className="flex justify-end gap-2">
                        {isMockPayment(payment) ? (
                          <Button
                            variant="outline"
                            size="sm"
                            loading={settleMock.isPending && settleMock.variables === payment.txRef}
                            onClick={() => settleMock.mutate(payment.txRef)}
                          >
                            Complete test payment
                          </Button>
                        ) : (
                          payment.checkoutUrl && (
                            <Button asChild variant="outline" size="sm">
                              <a href={payment.checkoutUrl}>
                                Resume <ExternalLink className="size-3.5" />
                              </a>
                            </Button>
                          )
                        )}
                        <Button asChild variant="ghost" size="sm">
                          <Link
                            to={`/billing?topup=${encodeURIComponent(payment.txRef)}&paymentId=${payment.id}`}
                          >
                            Check status
                          </Link>
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-fg-subtle">{payment.gatewayReference ?? '—'}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            page={payments.data.meta.page}
            limit={payments.data.meta.limit}
            total={payments.data.meta.total}
            onPageChange={setPage}
            itemLabel="payments"
          />
        </>
      )}
    </Card>
  );
}

function InvoicesTable() {
  const [page, setPage] = useState(1);
  const invoices = useInvoices(page);
  return (
    <Card>
      <CardHeader
        title="Invoices"
        description="Issued automatically for every successful top-up. Open one to print or save as PDF."
      />
      {invoices.isPending ? (
        <TableSkeleton rows={4} columns={4} />
      ) : invoices.isError ? (
        <ErrorState compact error={invoices.error} onRetry={() => void invoices.refetch()} />
      ) : invoices.data.data.length === 0 ? (
        <EmptyState
          compact
          title="No invoices yet"
          description="Your first invoice is issued as soon as a top-up is confirmed."
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>Status</TableHead>
                <TableHead numeric>Total</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Open</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.data.data.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell>
                    <Link
                      to={`/billing/invoices/${invoice.id}`}
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {invoice.invoiceNumber}
                    </Link>
                    <span className="block text-xs text-fg-subtle">{invoice.lineItems[0]?.description}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-fg-muted">
                    {formatDateTime(invoice.issuedAt)}
                  </TableCell>
                  <TableCell>
                    <InvoiceStatusBadge status={invoice.status} />
                  </TableCell>
                  <TableCell numeric className="font-semibold">
                    {formatEtb(invoice.totalEtb)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link to={`/billing/invoices/${invoice.id}`}>
                        <FileText className="size-4" /> View
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            page={invoices.data.meta.page}
            limit={invoices.data.meta.limit}
            total={invoices.data.meta.total}
            onPageChange={setPage}
            itemLabel="invoices"
          />
        </>
      )}
    </Card>
  );
}

function LedgerTable() {
  const [page, setPage] = useState(1);
  const ledger = useLedger(page);
  return (
    <Card>
      <CardHeader
        title="Wallet activity"
        description="Every movement on your wallet: top-ups in, budget reservations out, refunds back."
      />
      {ledger.isPending ? (
        <TableSkeleton rows={4} columns={4} />
      ) : ledger.isError ? (
        <ErrorState compact error={ledger.error} onRetry={() => void ledger.refetch()} />
      ) : ledger.data.data.length === 0 ? (
        <EmptyState
          compact
          title="No wallet activity yet"
          description="Top-ups and budget reservations will show up here."
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Entry</TableHead>
                <TableHead numeric>Amount</TableHead>
                <TableHead numeric>Balance after</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledger.data.data.map((entry) => {
                const credit = entry.amountEtb >= 0;
                return (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap text-fg-muted">
                      {formatDateTime(entry.createdAt)}
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            'flex size-7 items-center justify-center rounded-full',
                            credit ? 'bg-success/12 text-success' : 'bg-surface-muted text-fg-muted',
                          )}
                          aria-hidden="true"
                        >
                          {credit ? (
                            <ArrowDownLeft className="size-3.5" />
                          ) : (
                            <ArrowUpRight className="size-3.5" />
                          )}
                        </span>
                        <span>
                          <span className="block font-medium text-fg">
                            {LEDGER_LABEL[entry.entryType] ?? humanize(entry.entryType)}
                          </span>
                          {entry.description && (
                            <span className="block text-xs text-fg-subtle">{entry.description}</span>
                          )}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell numeric className={cn('font-semibold', credit ? 'text-success' : 'text-fg')}>
                      {credit ? '+' : '−'}
                      {formatEtb(Math.abs(entry.amountEtb))}
                    </TableCell>
                    <TableCell numeric className="text-fg-muted">
                      {formatEtb(entry.balanceAfterEtb)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <Pagination
            page={ledger.data.meta.page}
            limit={ledger.data.meta.limit}
            total={ledger.data.meta.total}
            onPageChange={setPage}
            itemLabel="entries"
          />
        </>
      )}
    </Card>
  );
}

function RefreshButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <Tooltip content="Refresh">
      <Button variant="ghost" size="icon-sm" onClick={onClick} aria-label="Refresh" disabled={loading}>
        <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
      </Button>
    </Tooltip>
  );
}
