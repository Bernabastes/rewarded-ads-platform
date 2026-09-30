import { ErrorCode, type LegalDocumentItem } from '@rap/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, FileText, ScrollText } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/primitives';
import { Skeleton, SkeletonText } from '@/components/ui/skeleton';
import { isApiError } from '@/lib/api/errors';
import { toastApiError } from '@/lib/forms';
import { queryKeys } from '@/lib/query/keys';
import { formatDate } from '@/lib/utils/format';
import { Markdown } from '@/lib/utils/markdown';
import type { AdvertiserConsentState } from '@/lib/api';
import { useAcceptTerms, useCurrentTerms } from './hooks';

export interface TermsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  description?: ReactNode;
  /**
   * When provided, the dialog asks for an explicit "I have read and accept" tick and shows this primary
   * action. Without it the dialog is read-only.
   */
  action?: { label: string; onAction: (doc: LegalDocumentItem) => void | Promise<void>; pending?: boolean };
  /** Secondary action label (defaults to "Close" / "Not now"). Set to null to hide it (blocking mode). */
  dismissLabel?: string | null;
  /** Extra content rendered above the doc (e.g. an error banner). */
  notice?: ReactNode;
}

/** Shows the current advertiser terms (Markdown from `GET /legal/current`) with an optional accept action. */
export function TermsDialog({
  open,
  onOpenChange,
  title,
  description,
  action,
  dismissLabel,
  notice,
}: TermsDialogProps) {
  const terms = useCurrentTerms({ enabled: open });
  // Keyed by document version so a re-opened dialog for a NEW version always starts unticked.
  const [confirmedVersion, setConfirmedVersion] = useState<string | null>(null);
  const checkboxId = useId();
  const doc = terms.data ?? null;
  const confirmed = !!doc && confirmedVersion === doc.version;

  const secondaryLabel = dismissLabel === undefined ? (action ? 'Not now' : 'Close') : dismissLabel;

  return (
    <Dialog open={open} onOpenChange={(next) => !action?.pending && onOpenChange(next)}>
      <DialogContent
        size="lg"
        hideClose={dismissLabel === null}
        onEscapeKeyDown={(event) => dismissLabel === null && event.preventDefault()}
        onPointerDownOutside={(event) => dismissLabel === null && event.preventDefault()}
        onInteractOutside={(event) => dismissLabel === null && event.preventDefault()}
        title={
          <span className="flex flex-wrap items-center gap-2">
            <ScrollText className="size-5 text-primary" />
            {title ?? doc?.title ?? 'Advertiser terms'}
            {doc && <Badge tone="primary">v{doc.version}</Badge>}
          </span>
        }
        description={
          description ??
          (doc
            ? `Published ${formatDate(doc.publishedAt)}. Please read the terms before accepting.`
            : 'Loading the current terms…')
        }
        footer={
          <>
            {secondaryLabel && (
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={action?.pending}>
                {secondaryLabel}
              </Button>
            )}
            {action && (
              <Button
                onClick={() => doc && void action.onAction(doc)}
                disabled={!doc || !confirmed}
                loading={action.pending}
                leadingIcon={<FileText className="size-4" />}
              >
                {action.label}
              </Button>
            )}
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {notice}
          {terms.isPending ? (
            <div className="flex flex-col gap-3" aria-busy="true">
              <Skeleton className="h-6 w-2/3" />
              <SkeletonText lines={4} />
            </div>
          ) : terms.isError || !doc ? (
            <Alert tone="warning" title="We could not load the terms right now">
              Please try again in a moment. If the problem persists, contact support.
            </Alert>
          ) : (
            <>
              <article
                className="max-h-[45vh] overflow-y-auto rounded-md border border-border bg-surface p-4 scrollbar-thin"
                aria-label={`${doc.title} v${doc.version}`}
                data-testid="terms-content"
              >
                {doc.contentMarkdown ? (
                  <Markdown source={doc.contentMarkdown} />
                ) : (
                  <p className="text-sm text-fg-muted">
                    The full text is hosted at the link below.
                  </p>
                )}
              </article>
              {doc.url && (
                <a
                  href={doc.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  Open the full text in a new tab <ExternalLink className="size-3.5" />
                </a>
              )}
              {action && (
                <label
                  htmlFor={checkboxId}
                  className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-surface-muted/60 p-3 text-sm text-fg"
                >
                  <Checkbox
                    id={checkboxId}
                    checked={confirmed}
                    onCheckedChange={(checked) => setConfirmedVersion(checked === true ? doc.version : null)}
                    className="mt-0.5"
                    disabled={action.pending}
                  />
                  <span>
                    I have read and accept the <strong className="font-semibold">{doc.title}</strong>{' '}
                    version {doc.version} on behalf of my business.
                  </span>
                </label>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export interface AcceptTermsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the API confirmed the acceptance (profile cache already patched). */
  onAccepted?: (state: AdvertiserConsentState) => void;
  /** Blocking variant: no dismiss action, cannot be closed by escape / outside click. */
  blocking?: boolean;
  title?: ReactNode;
  description?: ReactNode;
}

/**
 * Terms dialog wired to `POST /advertisers/me/consents`. A `409 CONSENT_VERSION_OUTDATED` (the terms changed
 * while the dialog was open) reloads the doc and asks the advertiser to re-read the new version.
 */
export function AcceptTermsDialog({
  open,
  onOpenChange,
  onAccepted,
  blocking,
  title,
  description,
}: AcceptTermsDialogProps) {
  const accept = useAcceptTerms();
  const queryClient = useQueryClient();
  // Derived from the mutation: a 409 means the document changed underneath the reader.
  const outdated =
    accept.isError && isApiError(accept.error) && accept.error.code === ErrorCode.CONSENT_VERSION_OUTDATED;

  return (
    <TermsDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) accept.reset();
        onOpenChange(next);
      }}
      title={title}
      description={description}
      dismissLabel={blocking ? null : undefined}
      notice={
        outdated && (
          <Alert tone="warning" title="The terms were updated while you were reading">
            We loaded the newest version below — please review and accept it.
          </Alert>
        )
      }
      action={{
        label: 'Accept and continue',
        pending: accept.isPending,
        onAction: async (doc) => {
          try {
            const state = await accept.mutateAsync(doc.version);
            onAccepted?.(state);
            onOpenChange(false);
          } catch (error) {
            if (isApiError(error) && error.code === ErrorCode.CONSENT_VERSION_OUTDATED) {
              await queryClient.invalidateQueries({ queryKey: queryKeys.legal.all });
              return;
            }
            toastApiError(error);
          }
        },
      }}
    />
  );
}
