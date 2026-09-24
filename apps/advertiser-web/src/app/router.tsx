import { createBrowserRouter, type RouteObject } from 'react-router';
import { AppShell } from '@/components/layout/app-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { RedirectIfAuthenticated, RequireAuth } from './guards';
import { NotFoundPage, RouteErrorPage } from './error-pages';

function HydrateFallback() {
  return (
    <div className="flex min-h-full items-center justify-center p-6" aria-busy="true">
      <div className="flex w-full max-w-md flex-col gap-4">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-2/3" />
      </div>
    </div>
  );
}

// Route-level code splitting: each page module is fetched on first navigation.
export const routes: RouteObject[] = [
  {
    errorElement: <RouteErrorPage />,
    hydrateFallbackElement: <HydrateFallback />,
    children: [
      {
        element: <RedirectIfAuthenticated />,
        children: [
          { path: '/login', lazy: () => import('@/features/auth/login-page').then((m) => ({ Component: m.LoginPage })) },
          {
            path: '/register',
            lazy: () => import('@/features/auth/register-page').then((m) => ({ Component: m.RegisterPage })),
          },
        ],
      },
      {
        element: (
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        ),
        children: [
          { index: true, lazy: () => import('@/features/dashboard/dashboard-page').then((m) => ({ Component: m.DashboardPage })) },
          {
            path: 'campaigns',
            children: [
              { index: true, lazy: () => import('@/features/campaigns/campaigns-page').then((m) => ({ Component: m.CampaignsPage })) },
              { path: 'new', lazy: () => import('@/features/campaigns/wizard/wizard-page').then((m) => ({ Component: m.WizardPage })) },
              { path: ':id', lazy: () => import('@/features/campaigns/campaign-detail-page').then((m) => ({ Component: m.CampaignDetailPage })) },
              { path: ':id/edit', lazy: () => import('@/features/campaigns/wizard/wizard-page').then((m) => ({ Component: m.WizardPage })) },
              { path: ':id/analytics', lazy: () => import('@/features/analytics/analytics-page').then((m) => ({ Component: m.AnalyticsPage })) },
            ],
          },
          { path: 'analytics', lazy: () => import('@/features/analytics/analytics-page').then((m) => ({ Component: m.AnalyticsPage })) },
          {
            path: 'billing',
            children: [
              { index: true, lazy: () => import('@/features/billing/billing-page').then((m) => ({ Component: m.BillingPage })) },
              { path: 'return', lazy: () => import('@/features/billing/billing-page').then((m) => ({ Component: m.BillingPage })) },
              { path: 'invoices/:id', lazy: () => import('@/features/billing/invoice-page').then((m) => ({ Component: m.InvoicePage })) },
            ],
          },
          { path: 'settings', lazy: () => import('@/features/settings/settings-page').then((m) => ({ Component: m.SettingsPage })) },
          { path: '*', element: <NotFoundPage embedded /> },
        ],
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
