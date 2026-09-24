import { BANNED_TOPICS, type BannedTopicKey } from '@rap/shared';
import { useEffect, useMemo, useState } from 'react';
import { composeRejectionReason, REJECTION_REASONS, type RejectionReasonKey } from '@/lib/domain/review-rules';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, NativeSelect, Textarea } from '@/components/ui/input';

export interface RejectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  adTitle: string;
  /** Topics the reviewer marked as present via the checklist. */
  flaggedTopics: BannedTopicKey[];
  loading?: boolean;
  serverError?: string | null;
  onConfirm: (reason: string) => void | Promise<void>;
}

const MIN_DETAIL = 5;

/** Structured + free-text rejection. The composed reason is what gets stored and shown to the advertiser. */
export function RejectDialog({ open, onOpenChange, adTitle, flaggedTopics, loading, serverError, onConfirm }: RejectDialogProps) {
  const [category, setCategory] = useState<RejectionReasonKey>(flaggedTopics.length ? 'banned_topic' : 'misleading');
  const [detail, setDetail] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setCategory(flaggedTopics.length ? 'banned_topic' : 'misleading');
      setDetail('');
      setTouched(false);
    }
  }, [open, flaggedTopics.length]);

  const composed = useMemo(() => composeRejectionReason(category, detail, category === 'banned_topic' ? flaggedTopics : []), [category, detail, flaggedTopics]);
  const needsDetail = category === 'other' || (category === 'banned_topic' && flaggedTopics.length === 0);
  const detailTooShort = detail.trim().length > 0 && detail.trim().length < MIN_DETAIL;
  const invalid = (needsDetail && detail.trim().length < MIN_DETAIL) || detailTooShort;
  const error = touched && invalid ? `Add at least ${MIN_DETAIL} characters of detail for this category.` : serverError ?? null;

  const submit = () => {
    setTouched(true);
    if (invalid) return;
    void onConfirm(composed);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      locked={loading}
      title="Reject creative"
      description={
        <>
          “{adTitle}” will be marked rejected and the advertiser sees the reason. This is written to the audit log.
        </>
      }
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button variant="danger" onClick={submit} loading={loading} disabled={touched && invalid}>
            Reject ad
          </Button>
        </>
      }
    >
      <div className="space-y-4" onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && submit()}>
        <Field label="Category" required>
          {(id) => (
            <NativeSelect id={id} value={category} onChange={(e) => setCategory(e.target.value as RejectionReasonKey)} autoFocus>
              {REJECTION_REASONS.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>

        {category === 'banned_topic' ? (
          <div className="rounded-md border border-danger/30 bg-danger/6 px-3 py-2 text-xs">
            {flaggedTopics.length ? (
              <>
                <span className="font-medium text-danger">Topics marked present:</span>{' '}
                {flaggedTopics.map((k) => BANNED_TOPICS.find((t) => t.key === k)?.label ?? k).join(', ')}
              </>
            ) : (
              <span className="text-fg-muted">Tip: use the “Flag” buttons on the checklist to name the topic(s), or describe them below.</span>
            )}
          </div>
        ) : null}

        <Field label="Details" required={needsDetail} error={error} hint={needsDetail ? 'Required for this category.' : 'Optional - be specific; the advertiser reads this.'}>
          {(id, describedBy) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              onBlur={() => setTouched(true)}
              rows={3}
              maxLength={900}
              invalid={Boolean(error)}
              placeholder="What exactly is wrong and how could it be fixed?"
            />
          )}
        </Field>

        <div>
          <div className="mb-1 text-2xs font-medium tracking-wider text-fg-subtle uppercase">Stored reason preview</div>
          <p className="rounded-md bg-sunken/60 px-2.5 py-1.5 font-mono text-xs text-fg-muted break-words">{composed}</p>
        </div>
      </div>
    </Dialog>
  );
}
