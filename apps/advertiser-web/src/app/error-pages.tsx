import { ArrowLeft, Home, RefreshCw } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isRouteErrorResponse, Link, useNavigate, useRouteError } from 'react-router';
import { ErrorIllustration, NotFoundIllustration } from '@/components/feedback/illustrations';
import { EmptyState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { describeApiError } from '@/lib/api/errors';

export function NotFoundPage({ embedded }: { embedded?: boolean }) {
  const navigate = useNavigate();
  return (
    <div className={embedded ? '' : 'flex min-h-full items-center justify-center p-6'}>
      <EmptyState
        illustration={<NotFoundIllustration className="h-auto w-full" />}
        title="This page does not exist"
        description="The link may be out of date, or the campaign you are looking for may have been removed."
        action={
          <>
            <Button
              variant="outline"
              onClick={() => navigate(-1)}
              leadingIcon={<ArrowLeft className="size-4" />}
            >
              Go back
            </Button>
            <Button asChild>
              <Link to="/">
                <Home className="size-4" /> Dashboard
              </Link>
            </Button>
          </>
        }
      />
    </div>
  );
}

/** react-router `errorElement`: renders 404s and unexpected render/loader errors. */
export function RouteErrorPage() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;
  const described = describeApiError(error);
  const message = error instanceof Error ? error.message : undefined;
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <EmptyState
        illustration={<ErrorIllustration className="h-auto w-full" />}
        title={described.title === 'Something went wrong' ? 'Something went wrong' : described.title}
        description={
          <>
            {described.description ?? 'An unexpected error interrupted this page.'}
            {import.meta.env.DEV && message ? (
              <code className="mt-3 block rounded-sm bg-surface-muted p-2 text-left text-xs text-fg-muted">
                {message}
              </code>
            ) : null}
          </>
        }
        action={
          <>
            <Button
              variant="outline"
              onClick={() => window.location.reload()}
              leadingIcon={<RefreshCw className="size-4" />}
            >
              Reload
            </Button>
            <Button asChild>
              <Link to="/">
                <Home className="size-4" /> Dashboard
              </Link>
            </Button>
          </>
        }
      />
    </div>
  );
}

interface BoundaryState {
  error: Error | null;
}

/** Top-level React error boundary (outside the router) so even provider failures render something friendly. */
export class RootErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error', error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-full items-center justify-center p-6">
        <EmptyState
          illustration={<ErrorIllustration className="h-auto w-full" />}
          title="Something went wrong"
          description="The portal hit an unexpected error. Reloading usually fixes it."
          action={
            <Button onClick={() => window.location.reload()} leadingIcon={<RefreshCw className="size-4" />}>
              Reload
            </Button>
          }
        />
      </div>
    );
  }
}
