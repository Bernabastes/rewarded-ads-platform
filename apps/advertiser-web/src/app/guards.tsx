import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '@/features/auth/auth-provider';

/** Redirects anonymous visitors to /login, remembering where they wanted to go. */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }
  return children ?? <Outlet />;
}

/** Keeps signed-in advertisers out of the auth pages. */
export function RedirectIfAuthenticated({ children }: { children?: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  if (isAuthenticated) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== '/login' && from !== '/register' ? from : '/'} replace />;
  }
  return children ?? <Outlet />;
}
