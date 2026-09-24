import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Mail, Phone, ShieldX, Wallet } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { toast } from 'sonner';
import { advertisersApi } from '@/lib/api/endpoints';
import { describeError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { useAuth } from '@/lib/auth/use-auth';
import { formatDate, formatDateTime, formatEtb } from '@/lib/utils/format';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, DescriptionList } from '@/components/ui/card';
import { ReasonDialog } from '@/components/ui/confirm';
import { ErrorState, Skeleton } from '@/components/ui/feedback';
import { IdChip, PageHeader } from '@/components/ui/page';
import { StatCard } from '@/components/ui/stat';
import { CampaignsTable } from '@/features/campaigns/campaigns-table';

export function AdvertiserDetailPage() {
  const { advertiserId = '' } = useParams();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const q = useQuery({ queryKey: queryKeys.advertiser(advertiserId), queryFn: () => advertisersApi.detail(advertiserId), enabled: Boolean(advertiserId) });
  const a = q.data;
  const [action, setAction] = useState<'verify' | 'reject' | null>(null);

  const decide = useMutation({
    mutationFn: ({ kind, text }: { kind: 'verify' | 'reject'; text: string }) => (kind === 'verify' ? advertisersApi.verify(advertiserId, text || undefined) : advertisersApi.reject(advertiserId, text)),
    onSuccess: (res, { kind }) => {
      toast.success(kind === 'verify' ? 'Advertiser verified' : 'Verification rejected', { description: kind === 'verify' ? 'They can now submit campaigns for review.' : 'The advertiser sees your reason in their portal.' });
      queryClient.setQueryData(queryKeys.advertiser(advertiserId), res);
      void queryClient.invalidateQueries({ queryKey: ['advertisers', 'list'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
      setAction(null);
    },
    onError: (err) => toast.error('Action failed', { description: describeError(err) }),
  });

  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Could not load advertiser" />;

  const canDecide = can('advertisersDecide');

  return (
    <div className="space-y-4">
      <PageHeader
        crumbs={[{ label: 'Advertisers', to: '/advertisers' }, { label: a?.businessName ?? '…' }]}
        title={
          a ? (
            <span className="flex flex-wrap items-center gap-2">
              {a.businessName} <StatusBadge status={a.verificationStatus} />
            </span>
          ) : (
            <Skeleton className="h-7 w-64" />
          )
        }
        description={a ? `Registered ${formatDate(a.createdAt)} · ${a.campaignsCount} campaign${a.campaignsCount === 1 ? '' : 's'}` : undefined}
        actions={
          a && canDecide ? (
            <>
              {a.verificationStatus !== 'rejected' ? (
                <Button variant="outline" onClick={() => setAction('reject')}>
                  <ShieldX className="size-4 text-danger" /> Reject
                </Button>
              ) : null}
              {a.verificationStatus !== 'verified' ? (
                <Button variant="success" onClick={() => setAction('verify')}>
                  <BadgeCheck className="size-4" /> Verify business
                </Button>
              ) : null}
            </>
          ) : null
        }
      />

      {a?.verificationStatus === 'pending' ? (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <span className="font-medium">Verification pending.</span> Check the registration number against the trade registry and confirm the contact details before verifying. Unverified advertisers cannot submit campaigns.
        </div>
      ) : null}
      {a?.verificationStatus === 'rejected' && a.verificationNote ? (
        <div className="rounded-md border border-danger/40 bg-danger/8 px-3 py-2 text-sm">
          <span className="font-medium">Rejected:</span> {a.verificationNote}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Wallet balance" value={a ? Number(a.walletBalanceEtb) : undefined} format={(v) => formatEtb(v)} loading={!a} icon={Wallet} tone="primary" hint="Available for new campaign reservations" />
        <StatCard label="Lifetime spend" value={a ? Number(a.lifetimeSpendEtb) : undefined} format={(v) => formatEtb(v)} loading={!a} hint="Sum of spent budget across campaigns" />
        <StatCard label="Campaigns" value={a?.campaignsCount} loading={!a} hint={a ? `${a.campaigns.filter((c) => c.status === 'active').length} active` : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Registration details" />
          <CardBody>
            {a ? (
              <DescriptionList
                columns={1}
                items={[
                  { label: 'Business name', value: a.businessName },
                  { label: 'Registration number', value: a.businessRegistrationNumber, mono: true },
                  {
                    label: 'Contact email',
                    value: (
                      <a href={`mailto:${a.contactEmail}`} className="inline-flex items-center gap-1 hover:text-primary hover:underline">
                        <Mail className="size-3" /> {a.contactEmail}
                      </a>
                    ),
                  },
                  {
                    label: 'Contact phone',
                    value: (
                      <span className="inline-flex items-center gap-1 font-mono text-xs">
                        <Phone className="size-3" /> {a.contactPhone}
                      </span>
                    ),
                  },
                  { label: 'Verification', value: <StatusBadge status={a.verificationStatus} /> },
                  { label: 'Verified by', value: <IdChip id={a.verifiedBy} /> },
                  { label: 'Decided at', value: formatDateTime(a.verifiedAt) },
                  { label: 'Note', value: a.verificationNote ?? '—' },
                  { label: 'Advertiser id', value: <IdChip id={a.id} length={36} /> },
                ]}
              />
            ) : (
              <Skeleton className="h-64 w-full" />
            )}
          </CardBody>
        </Card>
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Campaigns" description="Every campaign this advertiser has created, newest first." />
            <CardBody className="p-0">
              <CampaignsTable rows={a?.campaigns} isLoading={!a} showAdvertiser={false} emptyTitle="No campaigns yet" emptyDescription="Campaigns created in the advertiser portal appear here." />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Wallet ledger & payments" description="Not exposed by the admin API yet." />
            <CardBody className="text-xs text-fg-muted">
              The admin API currently returns the wallet balance and lifetime spend only. Top-ups, reservations and refunds are visible to the advertiser in their portal; a read-only admin
              endpoint for the advertiser ledger is listed under “API gaps” in the README.
            </CardBody>
          </Card>
        </div>
      </div>

      {a ? (
        <ReasonDialog
          open={action !== null}
          onOpenChange={(o) => !o && setAction(null)}
          destructive={action === 'reject'}
          optional={action === 'verify'}
          reasonLabel={action === 'verify' ? 'Note' : 'Reason'}
          title={action === 'verify' ? `Verify ${a.businessName}?` : `Reject ${a.businessName}?`}
          description={action === 'verify' ? 'Confirms the business registration. The advertiser can then fund the wallet and submit campaigns for review.' : 'The advertiser is told why and can re-apply after fixing the issue.'}
          confirmLabel={action === 'verify' ? 'Verify' : 'Reject verification'}
          confirmVariant={action === 'verify' ? 'success' : undefined}
          placeholder={action === 'verify' ? 'e.g. Registration MT/AA/5/0045678/2017 matches the trade registry.' : 'e.g. Registration number not found in the trade registry.'}
          loading={decide.isPending}
          onConfirm={(text) => { if (action) decide.mutate({ kind: action, text }); }}
        />
      ) : null}
    </div>
  );
}
