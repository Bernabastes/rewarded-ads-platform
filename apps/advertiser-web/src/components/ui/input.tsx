import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

export const inputClasses = (invalid?: boolean, className?: string) =>
  cn(
    'flex h-11 w-full min-w-0 rounded-md border bg-surface px-3.5 text-sm text-fg shadow-none transition-[border-color,box-shadow] duration-150',
    'placeholder:text-fg-subtle/80 hover:border-border-strong',
    'focus:border-ring focus:outline-none focus:ring-3 focus:ring-ring/20',
    'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-70',
    'file:mr-3 file:rounded-sm file:border-0 file:bg-primary-soft file:px-3 file:py-1 file:text-sm file:font-medium file:text-primary',
    invalid ? 'border-danger focus:border-danger focus:ring-danger/20' : 'border-border',
    className,
  );

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, leading, trailing, ...props },
  ref,
) {
  if (!leading && !trailing) {
    return <input ref={ref} aria-invalid={invalid || undefined} className={inputClasses(invalid, className)} {...props} />;
  }
  return (
    <div className="relative flex items-center">
      {leading && (
        <span className="pointer-events-none absolute left-3.5 flex items-center text-sm text-fg-subtle">
          {leading}
        </span>
      )}
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={inputClasses(invalid, cn(leading && 'pl-10', trailing && 'pr-12', className))}
        {...props}
      />
      {trailing && <span className="absolute right-2 flex items-center text-sm text-fg-subtle">{trailing}</span>}
    </div>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={inputClasses(invalid, cn('h-auto min-h-24 resize-y py-2.5 leading-relaxed', className))}
      {...props}
    />
  );
});
