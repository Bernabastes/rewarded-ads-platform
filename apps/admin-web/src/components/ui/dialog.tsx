import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';
import { Button } from './button';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Prevent closing via overlay / escape (e.g. while a mutation is pending). */
  locked?: boolean;
  /** Override Radix's default "focus first tabbable" behaviour (e.g. to focus a search input). */
  onOpenAutoFocus?: (event: Event) => void;
  /**
   * Render children without the padded, scrolling body so the child can own its layout (e.g. the command palette
   * pins its input and scrolls only the list). Hides the header when `title` should stay screen-reader only.
   */
  bare?: boolean;
  hideHeader?: boolean;
}

const sizes = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl', xl: 'max-w-4xl' };

export function Dialog({ open, onOpenChange, title, description, children, footer, size = 'md', locked, onOpenAutoFocus, bare, hideHeader }: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={locked ? () => undefined : onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="anim-fade-in fixed inset-0 z-50 bg-stone-950/40 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          onOpenAutoFocus={onOpenAutoFocus}
          className={cn(
            'anim-pop-in fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-surface shadow-pop outline-none',
            'flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden',
            sizes[size],
          )}
        >
          <div className={cn('flex items-start justify-between gap-4 border-b px-5 py-3.5', hideHeader && 'sr-only')}>
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-base font-semibold text-fg">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-0.5 text-xs text-fg-muted">{description}</DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</DialogPrimitive.Description>
              )}
            </div>
            {!locked && !hideHeader ? (
              <DialogPrimitive.Close asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Close">
                  <X className="size-4" />
                </Button>
              </DialogPrimitive.Close>
            ) : null}
          </div>
          {children ? bare ? <div className="flex min-h-0 flex-1 flex-col">{children}</div> : <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div> : null}
          {footer ? <div className="flex items-center justify-end gap-2 border-t bg-sunken/60 px-5 py-3">{footer}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* --------------------------------- Sheet --------------------------------- */

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: 'md' | 'lg' | 'xl';
}

const sheetWidths = { md: 'sm:max-w-md', lg: 'sm:max-w-xl', xl: 'sm:max-w-3xl' };

/** Right-hand drawer built on Radix Dialog. */
export function Sheet({ open, onOpenChange, title, description, children, footer, width = 'lg' }: SheetProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="anim-fade-in fixed inset-0 z-50 bg-stone-950/30 backdrop-blur-[1px]" />
        <DialogPrimitive.Content
          className={cn(
            'anim-slide-in-right fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-surface shadow-pop outline-none',
            sheetWidths[width],
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b px-5 py-3.5">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-base font-semibold text-fg">{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description className={description ? 'mt-0.5 text-xs text-fg-muted' : 'sr-only'}>
                {description ?? 'Details'}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close panel">
                <X className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-sunken/60 px-5 py-3">{footer}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
