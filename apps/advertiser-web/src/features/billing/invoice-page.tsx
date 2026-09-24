import { ErrorCode } from '@rap/shared';
import { ArrowLeft, Printer } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { NotFoundPage } from '@/app/error-pages';
import { ErrorState } from '@/components/feedback/states';
import { BrandMark } from '@/components/layout/brand-logo';
import { PageHeader } from '@/components/layout/page-header';
import { PageTransition } from '@/components/motion/motion';
import { InvoiceStatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton, SkeletonText } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BRAND_NAME, PRODUCT_NAME, SUPPORT_EMAIL } from '@/config/brand';
import { useAuth } from '@/features/auth/auth-provider';
import { isApiError } from '@/lib/api/errors';
import { formatDateTime, formatEtb } from '@/lib/utils/format';
import { useInvoice } from './hooks';

export function InvoicePage() {
  const { id = '' } = useParams<{ id: string }>();
  const invoice = useInvoice(id);
  const { profile } = useAuth();

  if (invoice.isError) {
    if (isApiError(invoice.error) && invoice.error.code === ErrorCode.NOT_FOUND) return <NotFoundPage embedded />;
    return (
      <Card>
        <ErrorState error={invoice.error} onRetry={() => void invoice.refetch()} />
      </Card>
    );
  }

  return (
    <PageTransition className="flex flex-col gap-6">
      <div className="print-hidden">
        <PageHeader
          crumbs={[{ label: 'Billing', to: '/billing' }, { label: invoice.data?.invoiceNumber ?? 'Invoice' }]}
          title={invoice.data ? `Invoice ${invoice.data.invoiceNumber}` : 'Invoice'}
          meta={invoice.data && <InvoiceStatusBadge status={invoice.data.status} />}
          actions={
            <>
              <Button asChild variant="ghost">
                <Link to="/billing">
                  <ArrowLeft className="size-4" /> Billing
                </Link>
              </Button>
              <Button onClick={() => window.print()} disabled={!invoice.data} leadingIcon={<Printer className="size-4" />}>
                Print / save PDF
              </Button>
            </>
          }
        />
      </div>

      <Card className="mx-auto w-full max-w-3xl print:border-0 print:shadow-none">
        <CardContent className="flex flex-col gap-8 p-8 sm:p-10">
          {invoice.isPending || !invoice.data ? (
            <div className="flex flex-col gap-6" aria-busy="true">
              <div className="flex justify-between">
                <Skeleton className="h-10 w-40" />
                <Skeleton className="h-10 w-32" />
              </div>
              <SkeletonText lines={3} />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : (
            <>
              <header className="flex flex-wrap items-start justify-between gap-6">
                <div className="flex items-center gap-3">
                  <BrandMark className="size-11" />
                  <div>
                    <p className="text-display text-xl font-bold text-fg">{PRODUCT_NAME}</p>
                    <p className="text-sm text-fg-subtle">Rewarded advertising · Addis Ababa, Ethiopia</p>
                    <p className="text-sm text-fg-subtle">{SUPPORT_EMAIL}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs font-medium tracking-wide text-fg-subtle uppercase">Invoice</p>
                  <p className="text-display text-2xl font-bold text-fg">{invoice.data.invoiceNumber}</p>
                  <p className="mt-1 text-sm text-fg-muted">Issued {formatDateTime(invoice.data.issuedAt)}</p>
                  {invoice.data.paidAt && <p className="text-sm text-fg-muted">Paid {formatDateTime(invoice.data.paidAt)}</p>}
                </div>
              </header>

              <section className="grid gap-6 border-y border-border py-6 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium tracking-wide text-fg-subtle uppercase">Billed to</p>
                  <p className="mt-1 font-semibold text-fg">{profile?.businessName}</p>
                  <p className="text-sm text-fg-muted">Reg. no. {profile?.businessRegistrationNumber}</p>
                  <p className="text-sm text-fg-muted">{profile?.contactEmail}</p>
                  <p className="text-sm text-fg-muted">{profile?.contactPhone}</p>
                </div>
                <div className="sm:text-right">
                  <p className="text-xs font-medium tracking-wide text-fg-subtle uppercase">Status</p>
                  <p className="mt-1 font-semibold text-fg capitalize">{invoice.data.status}</p>
                  <p className="text-sm text-fg-muted">Currency: {invoice.data.currency}</p>
                  {invoice.data.paymentId && <p className="text-sm text-fg-muted">Payment ref. {invoice.data.paymentId}</p>}
                </div>
              </section>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-0">Description</TableHead>
                    <TableHead numeric>Qty</TableHead>
                    <TableHead numeric>Unit price</TableHead>
                    <TableHead numeric className="pr-0">
                      Total
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoice.data.lineItems.map((item, index) => (
                    <TableRow key={index}>
                      <TableCell className="pl-0 font-medium">{item.description}</TableCell>
                      <TableCell numeric>{item.quantity}</TableCell>
                      <TableCell numeric>{formatEtb(item.unitPriceEtb)}</TableCell>
                      <TableCell numeric className="pr-0 font-semibold">
                        {formatEtb(item.totalEtb)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <dl className="ml-auto flex w-full max-w-xs flex-col gap-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-fg-muted">Subtotal</dt>
                  <dd className="tabular-nums text-fg">{formatEtb(invoice.data.subtotalEtb)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-fg-muted">VAT</dt>
                  <dd className="tabular-nums text-fg">{formatEtb(invoice.data.vatEtb)}</dd>
                </div>
                <div className="flex justify-between border-t border-border pt-2 text-base">
                  <dt className="font-semibold text-fg">Total</dt>
                  <dd className="text-display font-bold text-fg tabular-nums">{formatEtb(invoice.data.totalEtb)}</dd>
                </div>
              </dl>

              <footer className="border-t border-border pt-6 text-xs leading-relaxed text-fg-subtle">
                Thank you for advertising with {BRAND_NAME}. Funds are held as advertising credit in your wallet and consumed only by verified
                completions. This document was generated electronically and is valid without a signature.
              </footer>
            </>
          )}
        </CardContent>
      </Card>
    </PageTransition>
  );
}
