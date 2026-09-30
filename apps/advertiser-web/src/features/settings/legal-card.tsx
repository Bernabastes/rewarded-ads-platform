import type { AdvertiserProfile } from '@rap/shared';
import { CheckCircle2, ScrollText } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DescriptionList } from '@/components/ui/table';
import { useAdvertiserConsents, useCurrentTerms } from '@/features/legal/hooks';
import { AcceptTermsDialog, TermsDialog } from '@/features/legal/terms-dialog';
import { formatDateTime } from '@/lib/utils/format';

/** Settings → Legal: accepted vs current terms version, with read / accept actions. */
export function LegalCard({ profile }: { profile: AdvertiserProfile }) {
  const consents = useAdvertiserConsents();
  const terms = useCurrentTerms();
  const [readOpen, setReadOpen] = useState(false);
  const [acceptOpen, setAcceptOpen] = useState(false);

  const state = consents.data;
  const accepted = state?.acceptedTermsVersion ?? profile.acceptedTermsVersion;
  const current = state?.currentTermsVersion ?? profile.currentTermsVersion ?? terms.data?.version ?? null;
  const required = state?.requiresTermsAcceptance ?? profile.requiresTermsAcceptance;
  const acceptedAt = state?.consents.find((c) => c.kind === 'terms')?.acceptedAt ?? null;

  return (
    <Card className="h-full">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <ScrollText className="size-4 text-primary" /> Legal
          </span>
        }
        description="The advertiser terms you accepted and the version currently in force."
        action={
          required ? (
            <Badge tone="warning" dot>
              Acceptance required
            </Badge>
          ) : (
            <Badge tone="success" dot>
              Up to date
            </Badge>
          )
        }
      />
      <CardContent className="flex flex-col gap-4">
        {consents.isPending && !state ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
        ) : (
          <DescriptionList
            items={[
              {
                term: 'Accepted version',
                detail: accepted ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <span data-testid="accepted-terms-version">v{accepted}</span>
                    {acceptedAt && (
                      <span className="text-xs font-normal text-fg-subtle">on {formatDateTime(acceptedAt)}</span>
                    )}
                  </span>
                ) : (
                  <span className="text-fg-subtle">Not accepted yet</span>
                ),
              },
              {
                term: 'Current version',
                detail: current ? (
                  <span data-testid="current-terms-version">
                    v{current}
                    {terms.data?.publishedAt && (
                      <span className="ml-2 text-xs font-normal text-fg-subtle">
                        published {formatDateTime(terms.data.publishedAt)}
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="text-fg-subtle">No terms published</span>
                ),
              },
            ]}
          />
        )}
        {!required && accepted && (
          <p className="flex items-center gap-1.5 text-sm text-success">
            <CheckCircle2 className="size-4" /> You have accepted the current advertiser terms.
          </p>
        )}
        {required && (
          <p className="text-sm text-fg-muted">
            {accepted
              ? `Version ${accepted} is no longer current. Accept version ${current ?? ''} to keep submitting campaigns.`
              : 'Accept the current terms to submit campaigns for review.'}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" size="sm" onClick={() => setReadOpen(true)} disabled={!current}>
            Read the terms
          </Button>
          {required && (
            <Button size="sm" onClick={() => setAcceptOpen(true)} disabled={!current}>
              Review and accept
            </Button>
          )}
        </div>
      </CardContent>
      <TermsDialog open={readOpen} onOpenChange={setReadOpen} />
      <AcceptTermsDialog open={acceptOpen} onOpenChange={setAcceptOpen} />
    </Card>
  );
}
