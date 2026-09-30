import type { AdminKycSummary } from '@rap/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, CheckCircle2, ExternalLink, FlaskConical, ShieldQuestion, UserRound, Users, X, XCircle } from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { kycApi } from '@/lib/api/endpoints';
import { describeError, isApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { kycDecisionBlock, kycReviewWarnings, parseProviderResult, preCheckVerdict } from '@/lib/domain/kyc-rules';
import { cn } from '@/lib/utils/cn';
import { formatDate, formatDateTime, formatPercent, formatRelative, humanize } from '@/lib/utils/format';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, DescriptionList } from '@/components/ui/card';
import { ReasonDialog } from '@/components/ui/confirm';
import { Sheet } from '@/components/ui/dialog';
import { EmptyState, Kbd, Skeleton } from '@/components/ui/feedback';
import { JsonView } from '@/components/ui/json';
import { IdChip } from '@/components/ui/page';
import { Tooltip } from '@/components/ui/primitives';
import { type DocKind, KycDocuments } from './kyc-documents';

export interface KycSheetProps {
  id: string | null;
  /** Row from the list, for an instant header while the detail (with fresh presigned links) loads. */
  initial?: AdminKycSummary;
  onClose: () => void;
  /** Called after a decision so the page can remove the row and move to the next one. */
  onDecided: (id: string, result: AdminKycSummary) => void;
  canDecide: boolean;
  zoom: DocKind | null;
  onZoomChange: (kind: DocKind | null) => void;
  approveOpen: boolean;
  onApproveOpenChange: (open: boolean) => void;
  rejectOpen: boolean;
  onRejectOpenChange: (open: boolean) => void;
}

export function KycSheet({ id, initial, onClose, onDecided, canDecide, zoom, onZoomChange, approveOpen, onApproveOpenChange, rejectOpen, onRejectOpenChange }: KycSheetProps) {
  const queryClient = useQueryClient();
  // Presigned links last 5 minutes: never serve a cached detail, refetch every time the drawer opens.
  const detail = useQuery({
    queryKey: queryKeys.kyc(id ?? ''),
    queryFn: () => kycApi.detail(id!),
    enabled: Boolean(id),
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const d = detail.data;
  const head: AdminKycSummary | undefined = d ?? initial;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['kyc'] });
    void queryClient.invalidateQueries({ queryKey: ['users'] });
    void queryClient.invalidateQueries({ queryKey: ['audit'] });
  };

  const approve = useMutation({
    mutationFn: (note: string) => kycApi.approve(id!, note),
    onSuccess: (res) => {
      toast.success('KYC approved', { description: `${res.fullName} is now id-verified and can withdraw above the monthly phone-only limit.` });
      onApproveOpenChange(false);
      invalidate();
      onDecided(id!, res);
    },
    onError: (err) => toast.error('Could not approve', { description: describeError(err) }),
  });
  const reject = useMutation({
    mutationFn: (reason: string) => kycApi.reject(id!, reason),
    onSuccess: (res) => {
      toast.success('KYC rejected', { description: 'The user sees the reason in the app and may submit again.' });
      onRejectOpenChange(false);
      invalidate();
      onDecided(id!, res);
    },
    onError: (err) => {
      if (isApiError(err) && err.code === 'KYC_NOT_PENDING') {
        toast.error('Already decided', { description: describeError(err) });
        onRejectOpenChange(false);
        invalidate();
        return;
      }
      toast.error('Could not reject', { description: describeError(err) });
    },
  });

  const busy = approve.isPending || reject.isPending;
  const block = head ? kycDecisionBlock(head.status, canDecide) : 'Loading…';
  const warnings = d ? kycReviewWarnings(d) : [];
  const provider = d ? parseProviderResult(d.providerResult) : null;
  const verdict = preCheckVerdict(provider);

  return (
    <Sheet
      open={Boolean(id)}
      onOpenChange={(o) => !o && onClose()}
      width="xl"
      title={head ? `KYC · ${head.fullName}` : 'KYC submission'}
      description={head ? `${humanize(head.idType)} ending ${head.idNumberLast4} · submitted ${formatRelative(head.createdAt)}` : undefined}
      footer={
        head ? (
          <>
            {head.status === 'pending' ? (
              <>
                <Button variant="outline" onClick={() => onRejectOpenChange(true)} disabled={Boolean(block) || busy} data-testid="kyc-reject">
                  <X className="size-4 text-danger" /> Reject <Kbd className="ml-1">R</Kbd>
                </Button>
                <Tooltip content={block} disabled={!block}>
                  <span className="inline-flex" tabIndex={block ? 0 : -1}>
                    <Button variant="success" onClick={() => onApproveOpenChange(true)} disabled={Boolean(block) || busy} loading={approve.isPending} data-testid="kyc-approve">
                      <Check className="size-4" /> Approve <Kbd className="ml-1 border-white/30 bg-white/15 text-white">A</Kbd>
                    </Button>
                  </span>
                </Tooltip>
              </>
            ) : (
              <span className="text-xs text-fg-muted">Decided {formatDateTime(head.reviewedAt)}</span>
            )}
          </>
        ) : null
      }
    >
      {!head ? (
        detail.isError ? (
          <EmptyState compact title="Could not load submission" description={describeError(detail.error)} />
        ) : (
          <div className="space-y-3">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        )
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={head.status} />
            <Badge tone="neutral">{humanize(head.idType)}</Badge>
            <Badge tone={head.user.kycTier === 'id_verified' ? 'success' : 'outline'}>{humanize(head.user.kycTier)}</Badge>
            {provider?.mock ? (
              <Badge tone="warning" className="gap-1">
                <FlaskConical className="size-3" /> MOCK registry
              </Badge>
            ) : null}
            {d && d.duplicateIdentityUsers.length > 0 ? (
              <Badge tone="danger" className="gap-1">
                <Users className="size-3" /> {d.duplicateIdentityUsers.length} duplicate identit{d.duplicateIdentityUsers.length === 1 ? 'y' : 'ies'}
              </Badge>
            ) : null}
          </div>

          {warnings.length ? (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-fg" role="note" data-testid="kyc-warnings">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
              <ul className="space-y-0.5">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <Card>
            <CardHeader title="Documents" description="Compare the id photo with the selfie; check the name and number are legible." />
            <CardBody>
              {d ? (
                <KycDocuments detail={d} fetchedAt={detail.dataUpdatedAt} onRefresh={() => void detail.refetch()} refreshing={detail.isFetching} zoom={zoom} onZoomChange={onZoomChange} />
              ) : detail.isError ? (
                <EmptyState compact title="Documents unavailable" description={describeError(detail.error)} action={<Button variant="outline" size="sm" onClick={() => void detail.refetch()}>Retry</Button>} />
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  <Skeleton className="aspect-[4/3]" />
                  <Skeleton className="aspect-[4/3]" />
                  <Skeleton className="aspect-[4/3]" />
                </div>
              )}
            </CardBody>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Identity vs profile"
                actions={
                  <Link to={`/users/${head.userId}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                    <UserRound className="size-3" /> Open user
                  </Link>
                }
              />
              <CardBody>
                <DescriptionList
                  items={[
                    { label: 'Submitted name', value: <MatchValue value={head.fullName} match={d?.profileMatch.fullName} /> },
                    { label: 'Profile name', value: head.user.fullName ?? <span className="text-fg-subtle">not set</span> },
                    { label: 'Submitted DOB', value: <MatchValue value={formatDate(head.dateOfBirth)} match={d?.profileMatch.dateOfBirth} /> },
                    { label: 'Phone', value: head.user.phoneNumber, mono: true },
                    { label: 'Id number', value: `•••• ${head.idNumberLast4}`, mono: true },
                    { label: 'Trust score', value: <span className={cn('tabular font-medium', head.user.trustScore < 40 ? 'text-danger' : head.user.trustScore < 60 ? 'text-warning' : 'text-success')}>{head.user.trustScore}</span> },
                  ]}
                />
                {d && d.duplicateIdentityUsers.length > 0 ? (
                  <div className="mt-3 rounded-md border border-danger/40 bg-danger/8 px-3 py-2 text-xs">
                    <div className="flex items-start gap-2">
                      <Users className="mt-0.5 size-3.5 shrink-0 text-danger" />
                      <div>
                        <span className="font-medium">
                          Same id number on {d.duplicateIdentityUsers.length} other account{d.duplicateIdentityUsers.length === 1 ? '' : 's'}:
                        </span>
                        <ul className="mt-1 space-y-0.5">
                          {d.duplicateIdentityUsers.map((u) => (
                            <li key={u.id} className="flex items-center gap-2">
                              <Link to={`/users/${u.id}`} className="font-mono font-medium text-primary hover:underline">
                                {u.phoneNumber}
                              </Link>
                              <Badge tone={u.kycStatus === 'approved' ? 'success' : u.kycStatus === 'pending' ? 'warning' : 'neutral'}>{humanize(u.kycStatus)}</Badge>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                ) : null}
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Registry pre-check"
                description="Advisory only - you decide."
                actions={
                  provider ? (
                    <Badge tone={verdict === 'strong' ? 'success' : verdict === 'weak' ? 'warning' : 'danger'} className="gap-1 uppercase tracking-wide">
                      {verdict === 'strong' ? <CheckCircle2 className="size-3" /> : verdict === 'weak' ? <ShieldQuestion className="size-3" /> : <XCircle className="size-3" />}
                      {verdict === 'strong' ? 'match' : verdict === 'weak' ? 'weak match' : verdict === 'not_found' ? 'not found' : 'error'}
                    </Badge>
                  ) : null
                }
              />
              <CardBody>
                {provider ? (
                  <>
                    <DescriptionList
                      items={[
                        {
                          label: 'Provider',
                          value: (
                            <span className="inline-flex items-center gap-1.5">
                              {humanize(provider.provider)}
                              {provider.mock ? (
                                <Badge tone="warning" size="sm" className="gap-1">
                                  <FlaskConical className="size-2.5" /> MOCK
                                </Badge>
                              ) : null}
                            </span>
                          ),
                        },
                        { label: 'Score', value: <span className={cn('tabular font-semibold', provider.score >= 0.8 ? 'text-success' : provider.score > 0 ? 'text-warning' : 'text-danger')}>{formatPercent(provider.score, 0)}</span> },
                        { label: 'Name matches registry', value: <BoolBadge value={provider.match.fullName} /> },
                        { label: 'DOB matches registry', value: <BoolBadge value={provider.match.dateOfBirth} /> },
                        { label: 'Record found', value: <BoolBadge value={provider.found} /> },
                        ...(provider.error ? [{ label: 'Error', value: <span className="text-danger">{provider.error}</span>, span: 2 as const }] : []),
                      ]}
                    />
                    {provider.mock ? <p className="mt-3 text-2xs text-fg-subtle">Mock rule: id numbers ending in 99 return a name mismatch (score 40%), ending in 00 are “not found”, everything else matches at 97%.</p> : null}
                    <details className="mt-2 text-2xs text-fg-subtle">
                      <summary className="cursor-pointer">Raw provider result</summary>
                      <JsonView value={head.providerResult} maxHeight={160} className="mt-1" />
                    </details>
                  </>
                ) : (
                  <EmptyState compact title="No pre-check result" description="The registry provider did not return anything for this submission." />
                )}
              </CardBody>
            </Card>
          </div>

          {head.status !== 'pending' ? (
            <Card>
              <CardHeader title="Decision record" />
              <CardBody>
                <DescriptionList
                  items={[
                    { label: 'Decision', value: <StatusBadge status={head.status} /> },
                    { label: 'Reviewed at', value: formatDateTime(head.reviewedAt) },
                    { label: 'Reviewed by', value: <IdChip id={head.reviewedBy} />, span: 2 },
                    ...(head.reason ? [{ label: head.status === 'rejected' ? 'Reason shown to the user' : 'Note', value: <span className={head.status === 'rejected' ? 'text-danger' : undefined}>{head.reason}</span>, span: 2 as const }] : []),
                  ]}
                />
              </CardBody>
            </Card>
          ) : null}

          <div className="flex items-center justify-between text-2xs text-fg-subtle">
            <span>
              Submission <IdChip id={head.id} length={36} />
            </span>
            <Link to={`/audit?targetType=kyc_submission&targetId=${head.id}`} className="inline-flex items-center gap-1 hover:text-primary">
              Audit trail <ExternalLink className="size-3" />
            </Link>
          </div>
        </div>
      )}

      {head ? (
        <>
          <ReasonDialog
            open={approveOpen}
            onOpenChange={onApproveOpenChange}
            title={`Approve ${head.fullName}?`}
            description={`The user becomes id-verified (${humanize(head.idType)} ending ${head.idNumberLast4}) and the phone-only monthly payout cap no longer applies. Recorded in the audit log.`}
            confirmLabel="Approve KYC"
            confirmVariant="success"
            reasonLabel="Note"
            optional
            placeholder="Optional note for the audit log (e.g. selfie matches, checked Fayda card hologram)"
            loading={approve.isPending}
            onConfirm={(note) => approve.mutate(note)}
          >
            {warnings.length ? (
              <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                <span className="font-medium">Heads-up:</span> {warnings.join(' ')}
              </div>
            ) : null}
          </ReasonDialog>
          <ReasonDialog
            open={rejectOpen}
            onOpenChange={onRejectOpenChange}
            destructive
            title={`Reject ${head.fullName}'s submission?`}
            description="The reason is shown to the user in the app; they can submit new documents afterwards."
            confirmLabel="Reject KYC"
            reasonLabel="Reason (shown to the user)"
            minLength={3}
            placeholder="e.g. Document photo is blurry - please retake in good light"
            loading={reject.isPending}
            onConfirm={(reason) => reject.mutate(reason)}
          />
        </>
      ) : null}
    </Sheet>
  );
}

function MatchValue({ value, match }: { value: string; match: boolean | undefined }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span>{value}</span>
      {match === undefined ? null : (
        <Badge tone={match ? 'success' : 'danger'} size="sm" className="gap-0.5" data-testid={match ? 'profile-match' : 'profile-mismatch'}>
          {match ? <Check className="size-2.5" /> : <X className="size-2.5" />} {match ? 'matches profile' : 'differs from profile'}
        </Badge>
      )}
    </span>
  );
}

function BoolBadge({ value }: { value: boolean }) {
  return (
    <Badge tone={value ? 'success' : 'danger'} size="sm">
      {value ? 'yes' : 'no'}
    </Badge>
  );
}
