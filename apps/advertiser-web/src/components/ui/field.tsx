import { Label as RadixLabel } from 'radix-ui';
import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

export function Label({ className, ...props }: RadixLabel.LabelProps) {
  return (
    <RadixLabel.Root
      className={cn('text-sm font-medium text-fg leading-none peer-disabled:opacity-60', className)}
      {...props}
    />
  );
}

export interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  /** Provide when the control needs a fixed id (otherwise generated). */
  id?: string;
  className?: string;
  children: (props: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
  /** Render the label after the control (checkbox/switch layouts). */
  inline?: boolean;
}

/** Label + control + hint/error scaffold with the aria wiring done once. */
export function Field({
  label,
  hint,
  error,
  required,
  id: givenId,
  className,
  children,
  inline,
}: FieldProps) {
  const generated = useId();
  const id = givenId ?? generated;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  const labelNode = label ? (
    <Label htmlFor={id} className={cn(inline && 'font-normal')}>
      {label}
      {required && (
        <span className="ml-0.5 text-danger" aria-hidden="true">
          *
        </span>
      )}
    </Label>
  ) : null;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {inline ? (
        <div className="flex items-center gap-3">
          {children({ id, describedBy, invalid: !!error })}
          {labelNode}
        </div>
      ) : (
        <>
          {labelNode}
          {children({ id, describedBy, invalid: !!error })}
        </>
      )}
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-sm text-fg-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
