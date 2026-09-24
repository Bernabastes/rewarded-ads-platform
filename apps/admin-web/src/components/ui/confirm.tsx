import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import { AlertTriangle } from 'lucide-react';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { cn } from '@/lib/utils/cn';
import { Button, type ButtonVariant } from './button';
import { Field, Textarea } from './input';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Extra content between description and actions (e.g. summary of the record). */
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: ButtonVariant;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
}

/** Confirmation for irreversible actions that do not need a typed reason. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant,
  destructive,
  loading,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={loading ? () => undefined : onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="anim-fade-in fixed inset-0 z-50 bg-stone-950/40 backdrop-blur-[2px]" />
        <AlertDialogPrimitive.Content className="anim-pop-in fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-surface p-5 shadow-pop outline-none">
          <div className="flex gap-3">
            {destructive ? (
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-danger/12 text-danger">
                <AlertTriangle className="size-4.5" />
              </div>
            ) : null}
            <div className="min-w-0 flex-1">
              <AlertDialogPrimitive.Title className="text-base font-semibold text-fg">{title}</AlertDialogPrimitive.Title>
              <AlertDialogPrimitive.Description className={cn('mt-1 text-sm text-fg-muted', !description && 'sr-only')}>
                {description ?? 'Please confirm this action.'}
              </AlertDialogPrimitive.Description>
              {children ? <div className="mt-3">{children}</div> : null}
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialogPrimitive.Cancel asChild>
              <Button variant="outline" disabled={loading}>
                {cancelLabel}
              </Button>
            </AlertDialogPrimitive.Cancel>
            <Button variant={confirmVariant ?? (destructive ? 'danger' : 'primary')} loading={loading} onClick={() => void onConfirm()}>
              {confirmLabel}
            </Button>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

export interface ReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  confirmLabel?: string;
  confirmVariant?: ButtonVariant;
  destructive?: boolean;
  loading?: boolean;
  reasonLabel?: string;
  placeholder?: string;
  /** API DTOs require >= 5 chars for `reason`; notes are optional. */
  minLength?: number;
  optional?: boolean;
  /** Server-side field error to display under the textarea. */
  serverError?: string | null;
  onConfirm: (reason: string) => void | Promise<void>;
}

/** Confirmation that requires (or optionally accepts) a typed reason / note. */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel = 'Confirm',
  confirmVariant,
  destructive,
  loading,
  reasonLabel = 'Reason',
  placeholder = 'Explain the decision - this is written to the audit log.',
  minLength = 5,
  optional = false,
  serverError,
  onConfirm,
}: ReasonDialogProps) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const id = useId();

  useEffect(() => {
    if (!open) {
      setReason('');
      setTouched(false);
    }
  }, [open]);

  const trimmed = reason.trim();
  const tooShort = !optional && trimmed.length < minLength;
  const error = touched && tooShort ? `Please enter at least ${minLength} characters.` : serverError ?? null;

  const submit = () => {
    setTouched(true);
    if (tooShort) return;
    void onConfirm(trimmed);
  };

  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={loading ? () => undefined : onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="anim-fade-in fixed inset-0 z-50 bg-stone-950/40 backdrop-blur-[2px]" />
        <AlertDialogPrimitive.Content
          className="anim-pop-in fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-surface p-5 shadow-pop outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
        >
          <div className="flex gap-3">
            {destructive ? (
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-danger/12 text-danger">
                <AlertTriangle className="size-4.5" />
              </div>
            ) : null}
            <div className="min-w-0 flex-1">
              <AlertDialogPrimitive.Title className="text-base font-semibold text-fg">{title}</AlertDialogPrimitive.Title>
              <AlertDialogPrimitive.Description className={cn('mt-1 text-sm text-fg-muted', !description && 'sr-only')}>
                {description ?? 'Provide a reason to continue.'}
              </AlertDialogPrimitive.Description>
            </div>
          </div>
          {children ? <div className="mt-3">{children}</div> : null}
          <Field
            className="mt-4"
            label={reasonLabel}
            required={!optional}
            error={error}
            hint={optional ? 'Optional - stored with the decision.' : `At least ${minLength} characters. Stored in the audit log.`}
            htmlFor={id}
          >
            {(fieldId, describedBy) => (
              <Textarea
                id={fieldId}
                aria-describedby={describedBy}
                autoFocus
                value={reason}
                invalid={Boolean(error)}
                onChange={(e) => setReason(e.target.value)}
                onBlur={() => setTouched(true)}
                placeholder={placeholder}
                maxLength={1000}
                rows={3}
              />
            )}
          </Field>
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialogPrimitive.Cancel asChild>
              <Button variant="outline" disabled={loading}>
                Cancel
              </Button>
            </AlertDialogPrimitive.Cancel>
            <Button
              variant={confirmVariant ?? (destructive ? 'danger' : 'primary')}
              loading={loading}
              disabled={!optional && touched && tooShort}
              onClick={submit}
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
