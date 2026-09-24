import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Check } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

/* -------------------------------- Tooltip -------------------------------- */

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({
  content,
  children,
  side = 'top',
  disabled,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  disabled?: boolean;
}) {
  if (disabled || !content) return <>{children}</>;
  return (
    <TooltipPrimitive.Root delayDuration={250}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="anim-fade-in z-[60] max-w-xs rounded-md bg-stone-900 px-2.5 py-1.5 text-xs leading-snug text-stone-50 shadow-pop dark:bg-stone-100 dark:text-stone-900"
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-stone-900 dark:fill-stone-100" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/* -------------------------------- Checkbox ------------------------------- */

export interface CheckboxProps extends Omit<ComponentProps<typeof CheckboxPrimitive.Root>, 'children'> {
  label?: ReactNode;
  description?: ReactNode;
}

export function Checkbox({ label, description, className, id, ...props }: CheckboxProps) {
  const box = (
    <CheckboxPrimitive.Root
      id={id}
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-sm border border-border-strong bg-surface shadow-xs transition-colors',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-fg',
        'focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <Check className="size-3" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
  if (!label) return box;
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-2.5 text-sm select-none has-[[data-disabled]]:cursor-not-allowed">
      <span className="mt-0.5">{box}</span>
      <span className="min-w-0">
        <span className="block leading-snug text-fg">{label}</span>
        {description ? <span className="block text-xs text-fg-subtle">{description}</span> : null}
      </span>
    </label>
  );
}

/* ---------------------------------- Tabs --------------------------------- */

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn('inline-flex h-8 items-center gap-0.5 rounded-md bg-sunken p-0.5 text-fg-muted', className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-xs font-medium whitespace-nowrap transition-colors',
        'hover:text-fg data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-xs',
        'focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

/** Underline-style tabs for page-level sections. */
export function TabsUnderline({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn('flex items-center gap-4 border-b', className)} {...props} />;
}

export function TabsUnderlineTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        '-mb-px inline-flex h-9 items-center gap-1.5 border-b-2 border-transparent px-1 text-sm font-medium text-fg-muted whitespace-nowrap transition-colors',
        'hover:text-fg data-[state=active]:border-primary data-[state=active]:text-fg',
        'focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
        className,
      )}
      {...props}
    />
  );
}

export const TabsContent = TabsPrimitive.Content;

/* ------------------------------ DropdownMenu ----------------------------- */

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export function DropdownMenuContent({ className, sideOffset = 6, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn('anim-fade-in z-50 min-w-44 rounded-lg border bg-elevated p-1 shadow-pop', className)}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({ className, destructive, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Item> & { destructive?: boolean }) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        'flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm text-fg outline-none select-none',
        'data-[highlighted]:bg-sunken data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        destructive && 'text-danger data-[highlighted]:bg-danger/10',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return <DropdownMenuPrimitive.Label className={cn('px-2 py-1.5 text-2xs font-semibold uppercase tracking-wider text-fg-subtle', className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return <DropdownMenuPrimitive.Separator className={cn('my-1 h-px bg-border', className)} {...props} />;
}
