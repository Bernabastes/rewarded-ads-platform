import { X } from 'lucide-react';
import { Dialog as RadixDialog } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

export interface DialogContentProps extends Omit<RadixDialog.DialogContentProps, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  hideClose?: boolean;
  footer?: ReactNode;
}

const SIZES = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

export function DialogContent({
  title,
  description,
  size = 'md',
  hideClose,
  footer,
  className,
  children,
  ...props
}: DialogContentProps) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-50 bg-stone-950/40 backdrop-blur-[2px] data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out dark:bg-stone-950/70" />
      <RadixDialog.Content
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-surface-elevated shadow-pop outline-none',
          'data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out',
          SIZES[size],
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6">
          <div className="min-w-0">
            <RadixDialog.Title className="text-display text-lg font-semibold text-fg">
              {title}
            </RadixDialog.Title>
            {description ? (
              <RadixDialog.Description className="mt-1 text-sm text-fg-muted">
                {description}
              </RadixDialog.Description>
            ) : (
              <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
            )}
          </div>
          {!hideClose && (
            <RadixDialog.Close
              className="-mt-1 -mr-2 flex size-10 shrink-0 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-surface-muted hover:text-fg"
              aria-label="Close"
            >
              <X className="size-5" />
            </RadixDialog.Close>
          )}
        </div>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border px-6 py-4">
            {footer}
          </div>
        )}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
