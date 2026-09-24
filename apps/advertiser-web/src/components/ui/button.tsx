import { Slot } from 'radix-ui';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';
import { Spinner } from './spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'accent' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-primary-fg shadow-soft hover:bg-primary-hover active:translate-y-px disabled:hover:bg-primary',
  accent: 'bg-accent text-accent-fg shadow-soft hover:bg-accent-hover active:translate-y-px disabled:hover:bg-accent',
  secondary: 'bg-primary-soft text-primary hover:bg-forest-100 dark:hover:bg-forest-900/60',
  outline: 'border border-border-strong bg-surface text-fg hover:bg-surface-muted',
  ghost: 'text-fg-muted hover:bg-surface-muted hover:text-fg',
  danger: 'bg-danger text-white hover:bg-danger/90',
  link: 'text-primary underline-offset-4 hover:underline h-auto px-0 min-h-0',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 min-h-9 px-3 text-sm gap-1.5 rounded-sm',
  md: 'h-11 min-h-11 px-4 text-sm gap-2 rounded-md',
  lg: 'h-12 min-h-12 px-6 text-base gap-2 rounded-md',
  icon: 'h-11 w-11 min-h-11 rounded-md',
  'icon-sm': 'h-9 w-9 min-h-9 rounded-sm',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  asChild?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export const buttonClasses = ({
  variant = 'primary',
  size = 'md',
  className,
}: Pick<ButtonProps, 'variant' | 'size' | 'className'>) =>
  cn(
    'inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-[background-color,color,transform,box-shadow] duration-150 select-none',
    'disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
    VARIANTS[variant],
    SIZES[size],
    className,
  );

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, asChild = false, leadingIcon, trailingIcon, className, children, disabled, type, ...props },
  ref,
) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      ref={ref}
      className={buttonClasses({ variant, size, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      type={asChild ? undefined : (type ?? 'button')}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading ? <Spinner className="size-4" /> : leadingIcon}
          {children}
          {!loading && trailingIcon}
        </>
      )}
    </Comp>
  );
});
