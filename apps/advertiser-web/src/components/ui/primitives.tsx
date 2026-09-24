import { Check, ChevronDown } from 'lucide-react';
import { DropdownMenu as RadixDropdown, Select as RadixSelect, Tooltip as RadixTooltip, Tabs as RadixTabs, Switch as RadixSwitch, Checkbox as RadixCheckbox, Popover as RadixPopover } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

/* ---------------------------------- Tooltip --------------------------------- */

export const TooltipProvider = RadixTooltip.Provider;

export function Tooltip({ content, children, side = 'top' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <RadixTooltip.Root delayDuration={200}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-xs animate-slide-up rounded-sm bg-stone-900 px-3 py-2 text-xs leading-relaxed text-stone-50 shadow-pop dark:bg-stone-100 dark:text-stone-900"
        >
          {content}
          <RadixTooltip.Arrow className="fill-stone-900 dark:fill-stone-100" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

/* ------------------------------- Dropdown menu ------------------------------ */

export const DropdownMenu = RadixDropdown.Root;
export const DropdownMenuTrigger = RadixDropdown.Trigger;
export const DropdownMenuSeparator = ({ className }: { className?: string }) => (
  <RadixDropdown.Separator className={cn('my-1 h-px bg-border', className)} />
);

export function DropdownMenuContent({ className, children, ...props }: RadixDropdown.DropdownMenuContentProps) {
  return (
    <RadixDropdown.Portal>
      <RadixDropdown.Content
        sideOffset={6}
        align="end"
        className={cn(
          'z-50 min-w-48 animate-slide-up rounded-md border border-border bg-surface-elevated p-1.5 shadow-pop outline-none',
          className,
        )}
        {...props}
      >
        {children}
      </RadixDropdown.Content>
    </RadixDropdown.Portal>
  );
}

export function DropdownMenuItem({ className, destructive, ...props }: RadixDropdown.DropdownMenuItemProps & { destructive?: boolean }) {
  return (
    <RadixDropdown.Item
      className={cn(
        'flex min-h-10 cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm text-fg outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-muted',
        destructive && 'text-danger data-[highlighted]:bg-danger/10',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({ className, ...props }: RadixDropdown.DropdownMenuLabelProps) {
  return <RadixDropdown.Label className={cn('px-2.5 py-1.5 text-xs font-medium text-fg-subtle', className)} {...props} />;
}

/* ---------------------------------- Popover --------------------------------- */

export const Popover = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;
export function PopoverContent({ className, ...props }: RadixPopover.PopoverContentProps) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        sideOffset={6}
        className={cn('z-50 w-72 animate-slide-up rounded-md border border-border bg-surface-elevated p-4 shadow-pop outline-none', className)}
        {...props}
      />
    </RadixPopover.Portal>
  );
}

/* ----------------------------------- Select --------------------------------- */

export interface SelectOption<T extends string = string> {
  value: T;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export interface SelectProps<T extends string> {
  value: T | undefined;
  onValueChange: (value: T) => void;
  options: readonly SelectOption<T>[];
  placeholder?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
  invalid?: boolean;
  'aria-label'?: string;
  'aria-describedby'?: string;
  size?: 'sm' | 'md';
}

export function Select<T extends string>({
  value,
  onValueChange,
  options,
  placeholder = 'Select…',
  id,
  className,
  disabled,
  invalid,
  size = 'md',
  ...aria
}: SelectProps<T>) {
  return (
    <RadixSelect.Root value={value} onValueChange={(v) => onValueChange(v as T)} disabled={disabled}>
      <RadixSelect.Trigger
        id={id}
        aria-invalid={invalid || undefined}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-md border bg-surface px-3.5 text-left text-sm text-fg transition-[border-color,box-shadow] hover:border-border-strong focus:border-ring focus:outline-none focus:ring-3 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-60 data-[placeholder]:text-fg-subtle',
          size === 'sm' ? 'h-9' : 'h-11',
          invalid ? 'border-danger' : 'border-border',
          className,
        )}
        {...aria}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon>
          <ChevronDown className="size-4 text-fg-subtle" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={6}
          className="z-50 max-h-72 min-w-(--radix-select-trigger-width) animate-slide-up overflow-hidden rounded-md border border-border bg-surface-elevated p-1.5 shadow-pop"
        >
          <RadixSelect.Viewport>
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="flex min-h-10 cursor-pointer items-center justify-between gap-3 rounded-sm px-2.5 py-2 text-sm text-fg outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-muted"
              >
                <div className="min-w-0">
                  <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                  {option.description && <div className="text-xs text-fg-subtle">{option.description}</div>}
                </div>
                <RadixSelect.ItemIndicator>
                  <Check className="size-4 text-primary" />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

/* ------------------------------------ Tabs ---------------------------------- */

export const Tabs = RadixTabs.Root;
export const TabsContent = RadixTabs.Content;

export function TabsList({ className, ...props }: RadixTabs.TabsListProps) {
  return (
    <RadixTabs.List
      className={cn('inline-flex h-11 items-center gap-1 rounded-md bg-surface-muted p-1', className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: RadixTabs.TabsTriggerProps) {
  return (
    <RadixTabs.Trigger
      className={cn(
        'inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-sm px-3 text-sm font-medium text-fg-muted transition-colors hover:text-fg data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-soft',
        className,
      )}
      {...props}
    />
  );
}

/* ----------------------------------- Switch --------------------------------- */

export function Switch({ className, ...props }: RadixSwitch.SwitchProps) {
  return (
    <RadixSwitch.Root
      className={cn(
        'relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-stone-300 transition-colors data-[state=checked]:bg-primary disabled:cursor-not-allowed disabled:opacity-50 dark:bg-stone-700',
        className,
      )}
      {...props}
    >
      <RadixSwitch.Thumb className="pointer-events-none block size-6 rounded-full bg-white shadow-soft transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0" />
    </RadixSwitch.Root>
  );
}

/* ---------------------------------- Checkbox -------------------------------- */

export function Checkbox({ className, ...props }: RadixCheckbox.CheckboxProps) {
  return (
    <RadixCheckbox.Root
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-[6px] border border-border-strong bg-surface transition-colors data-[state=checked]:border-primary data-[state=checked]:bg-primary disabled:opacity-50',
        'aria-[invalid=true]:border-danger',
        className,
      )}
      {...props}
    >
      <RadixCheckbox.Indicator>
        <Check className="size-3.5 text-primary-fg" strokeWidth={3} />
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  );
}
