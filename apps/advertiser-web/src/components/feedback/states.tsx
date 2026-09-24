import { RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { describeApiError } from '@/lib/api/errors';
import { cn } from '@/lib/utils/cn';
import { Button } from '../ui/button';
import { EmptyCampaignsIllustration, ErrorIllustration } from './illustrations';

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  illustration?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}

export function EmptyState({
  title,
  description,
  illustration,
  action,
  className,
  compact,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'px-6 py-10' : 'px-6 py-16',
        className,
      )}
    >
      <div className={cn('text-fg', compact ? 'w-40' : 'w-56')}>
        {illustration ?? <EmptyCampaignsIllustration className="h-auto w-full" />}
      </div>
      <h3 className={cn('text-display mt-5 font-semibold text-fg', compact ? 'text-base' : 'text-lg')}>
        {title}
      </h3>
      {description && <p className="mt-2 max-w-md text-sm leading-relaxed text-fg-muted">{description}</p>}
      {action && <div className="mt-6 flex flex-wrap items-center justify-center gap-3">{action}</div>}
    </div>
  );
}

export interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  title?: ReactNode;
  className?: string;
  compact?: boolean;
}

export function ErrorState({ error, onRetry, title, className, compact }: ErrorStateProps) {
  const described = describeApiError(error);
  return (
    <EmptyState
      compact={compact}
      className={className}
      illustration={<ErrorIllustration className="h-auto w-full" />}
      title={title ?? described.title}
      description={described.description ?? 'Please try again.'}
      action={
        onRetry && (
          <Button variant="outline" onClick={onRetry} leadingIcon={<RefreshCw className="size-4" />}>
            Try again
          </Button>
        )
      }
    />
  );
}
