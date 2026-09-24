import { Compass } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link, isRouteErrorResponse, useRouteError } from 'react-router';
import { EmptyState, ErrorState } from '@/components/ui/feedback';

export function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <EmptyState
        icon={Compass}
        title="This page doesn’t exist"
        description="The link may be outdated, or the record may have been removed. Use the command palette (Ctrl/⌘ K) to jump anywhere."
        action={
          <Link to="/" className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-fg hover:bg-primary-hover">
            Back to overview
          </Link>
        }
      />
    </div>
  );
}

/** Route-level error element for react-router. */
export function RouteErrorPage() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;
  const message = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : error instanceof Error ? error.message : 'Unknown error';
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <ErrorState error={new Error(message)} title="This view crashed" onRetry={() => window.location.reload()} />
    </div>
  );
}

interface BoundaryState {
  error: Error | null;
}

/** Class error boundary wrapping each page so one broken view never blanks the whole console. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[admin-web] render error', error, info.componentStack);
  }

  override componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-[50vh] items-center justify-center">
          <ErrorState error={this.state.error} title="Something broke while rendering" onRetry={() => this.setState({ error: null })} />
        </div>
      );
    }
    return this.props.children;
  }
}
