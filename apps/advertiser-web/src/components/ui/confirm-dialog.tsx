import { AlertDialog as RadixAlertDialog } from 'radix-ui';
import { useState, type ReactNode } from 'react';
import { Button, type ButtonVariant } from './button';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: ButtonVariant;
  /** Return a promise to keep the dialog open with a loading state until it settles. */
  onConfirm: () => void | Promise<unknown>;
  children?: ReactNode;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'primary',
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);

  const handleConfirm = async () => {
    try {
      setPending(true);
      await onConfirm();
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  };

  return (
    <RadixAlertDialog.Root open={open} onOpenChange={pending ? undefined : onOpenChange}>
      <RadixAlertDialog.Portal>
        <RadixAlertDialog.Overlay className="fixed inset-0 z-50 bg-stone-950/40 backdrop-blur-[2px] data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out dark:bg-stone-950/70" />
        <RadixAlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface-elevated p-6 shadow-pop outline-none data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out">
          <RadixAlertDialog.Title className="text-display text-lg font-semibold text-fg">{title}</RadixAlertDialog.Title>
          {description && (
            <RadixAlertDialog.Description className="mt-2 text-sm leading-relaxed text-fg-muted">
              {description}
            </RadixAlertDialog.Description>
          )}
          {children && <div className="mt-4">{children}</div>}
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <RadixAlertDialog.Cancel asChild>
              <Button variant="outline" disabled={pending}>
                {cancelLabel}
              </Button>
            </RadixAlertDialog.Cancel>
            <Button variant={confirmVariant} loading={pending} onClick={handleConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </RadixAlertDialog.Content>
      </RadixAlertDialog.Portal>
    </RadixAlertDialog.Root>
  );
}
