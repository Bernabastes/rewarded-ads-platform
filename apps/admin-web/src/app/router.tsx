import { lazy, Suspense, type ComponentType } from 'react';
import { createBrowserRouter, Outlet, type RouteObject } from 'react-router';
import type { AccessKey } from '@/lib/auth/rbac';
import { RedirectIfAuthed, RequireAuth, RequireRole } from '@/components/guards/guards';
import { AppShell } from '@/components/layout/app-shell';
import { SkeletonCard, SkeletonRows } from '@/components/ui/feedback';
import { ErrorBoundary, NotFoundPage, RouteErrorPage } from '@/features/errors/error-pages';
import { LoginPage } from '@/features/auth/login-page';

function PageFallback() {
  return (
    <div className="space-y-4" aria-busy>
      <div className="h-6 w-48 animate-pulse rounded bg-stone-200/80 dark:bg-stone-800" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
      <div className="rounded-lg border bg-surface">
        <SkeletonRows rows={6} />
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loader = () => Promise<Record<string, ComponentType<any>>>;

/** Lazy page wrapped in Suspense + per-page error boundary + role guard. */
function page(loader: Loader, exportName: string, access?: AccessKey): RouteObject['element'] {
  const Component = lazy(async () => {
    const mod = await loader();
    return { default: mod[exportName]! };
  });
  const content = (
    <ErrorBoundary>
      <Suspense fallback={<PageFallback />}>
        <Component />
      </Suspense>
    </ErrorBoundary>
  );
  return access ? <RequireRole access={access}>{content}</RequireRole> : content;
}

export const routes: RouteObject[] = [
  {
    path: '/login',
    element: (
      <RedirectIfAuthed>
        <LoginPage />
      </RedirectIfAuthed>
    ),
    errorElement: <RouteErrorPage />,
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: page(() => import('@/features/overview/overview-page'), 'OverviewPage', 'overview') },
      { path: 'review', element: page(() => import('@/features/review/review-page'), 'ReviewPage', 'reviewQueue') },
      { path: 'review/:adId', element: page(() => import('@/features/review/review-page'), 'ReviewPage', 'reviewQueue') },
      {
        path: 'campaigns',
        element: <Outlet />,
        children: [
          { index: true, element: page(() => import('@/features/campaigns/campaigns-page'), 'CampaignsPage', 'campaigns') },
          { path: ':campaignId', element: page(() => import('@/features/campaigns/campaign-detail-page'), 'CampaignDetailPage', 'campaigns') },
        ],
      },
      { path: 'ad-reports', element: page(() => import('@/features/reports/ad-reports-page'), 'AdReportsPage', 'adReports') },
      { path: 'app-installs', element: page(() => import('@/features/installs/app-installs-page'), 'AppInstallsPage', 'appInstalls') },
      {
        path: 'users',
        element: <Outlet />,
        children: [
          { index: true, element: page(() => import('@/features/users/users-page'), 'UsersPage', 'users') },
          { path: ':userId', element: page(() => import('@/features/users/user-detail-page'), 'UserDetailPage', 'users') },
          { path: ':userId/view-as', element: page(() => import('@/features/users/view-as-user-page'), 'ViewAsUserPage', 'impersonate') },
        ],
      },
      { path: 'kyc', element: page(() => import('@/features/kyc/kyc-page'), 'KycPage', 'kyc') },
      { path: 'kyc/:kycId', element: page(() => import('@/features/kyc/kyc-page'), 'KycPage', 'kyc') },
      { path: 'referrals', element: page(() => import('@/features/referrals/referrals-page'), 'ReferralsPage', 'referrals') },
      { path: 'deletion-requests', element: page(() => import('@/features/deletion/deletion-requests-page'), 'DeletionRequestsPage', 'deletionRequests') },
      { path: 'alerts', element: page(() => import('@/features/alerts/alerts-page'), 'AlertsPage', 'alerts') },
      {
        path: 'advertisers',
        element: <Outlet />,
        children: [
          { index: true, element: page(() => import('@/features/advertisers/advertisers-page'), 'AdvertisersPage', 'advertisers') },
          { path: ':advertiserId', element: page(() => import('@/features/advertisers/advertiser-detail-page'), 'AdvertiserDetailPage', 'advertisers') },
        ],
      },
      { path: 'fraud', element: page(() => import('@/features/fraud/fraud-page'), 'FraudPage', 'fraud') },
      { path: 'fraud/:flagId', element: page(() => import('@/features/fraud/fraud-page'), 'FraudPage', 'fraud') },
      { path: 'withdrawals', element: page(() => import('@/features/withdrawals/withdrawals-page'), 'WithdrawalsPage', 'withdrawals') },
      { path: 'withdrawals/:withdrawalId', element: page(() => import('@/features/withdrawals/withdrawals-page'), 'WithdrawalsPage', 'withdrawals') },
      { path: 'adjustments', element: page(() => import('@/features/adjustments/adjustments-page'), 'AdjustmentsPage', 'adjustments') },
      { path: 'adjustments/:adjustmentId', element: page(() => import('@/features/adjustments/adjustments-page'), 'AdjustmentsPage', 'adjustments') },
      { path: 'revenue', element: page(() => import('@/features/revenue/revenue-page'), 'RevenuePage', 'revenue') },
      { path: 'audit', element: page(() => import('@/features/audit/audit-page'), 'AuditPage', 'audit') },
      { path: 'config', element: page(() => import('@/features/config/config-page'), 'ConfigPage', 'config') },
      { path: 'admins', element: page(() => import('@/features/admins/admins-page'), 'AdminsPage', 'adminAccounts') },
      { path: 'account/security', element: page(() => import('@/features/account/security-page'), 'SecurityPage', 'accountSecurity') },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
