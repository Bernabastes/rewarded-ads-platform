import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { type AccessKey, rolesFor } from '@/lib/auth/rbac';
import { useAuth } from '@/lib/auth/use-auth';
import { APP_NAME } from '@/lib/brand';
import { NoAccessState } from '@/components/ui/feedback';
import { BrandMark } from '@/components/layout/sidebar';

/** Full-screen splash while the session is being restored. */
export function BootSplash() {
  return (
    <div className="flex h-full min-h-screen items-center justify-center bg-bg">
      <div className="flex flex-col items-center gap-3">
        <BrandMark className="size-10 animate-pulse" />
        <p className="text-xs text-fg-subtle">Restoring your {APP_NAME} session…</p>
      </div>
    </div>
  );
}

/** Redirects anonymous visitors to /login (remembering where they were heading). */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status === 'booting') return <BootSplash />;
  if (state.status !== 'authenticated') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return children ? <>{children}</> : <Outlet />;
}

/** Sends authenticated admins away from the login page. */
export function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status === 'booting') return <BootSplash />;
  if (state.status === 'authenticated') {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== '/login' ? from : '/'} replace />;
  }
  return <>{children}</>;
}

/** Renders the designed "no access" state when the current role is not allowed. */
export function RequireRole({ access, children }: { access: AccessKey; children?: ReactNode }) {
  const { can } = useAuth();
  if (!can(access)) return <NoAccessState requiredRoles={rolesFor(access)} />;
  return children ? <>{children}</> : <Outlet />;
}
