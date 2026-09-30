import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BadgeCheck,
  Banknote,
  BellRing,
  Building2,
  Coins,
  Flag,
  Gift,
  IdCard,
  LayoutDashboard,
  Megaphone,
  ScrollText,
  Settings2,
  ShieldAlert,
  Smartphone,
  UserRoundX,
  Users,
  Video,
} from 'lucide-react';
import type { AccessKey } from '@/lib/auth/rbac';

/** Sidebar badge sources: `AdminOverview` counters plus the Phase 4A queues (see `useQueueCounters`). */
export type NavCounterKey =
  | 'pendingAdReviews'
  | 'pendingCampaignReviews'
  | 'pendingAdvertiserVerifications'
  | 'withdrawalsAwaitingReview'
  | 'pendingCoinAdjustments'
  | 'openFraudFlags'
  | 'openAdReports'
  | 'pendingKyc'
  | 'openAlerts'
  | 'pendingDeletionRequests';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  access: AccessKey;
  /** Sequence hotkey (pressed after "g"), e.g. "r" → g r. */
  key?: string;
  description?: string;
  /** Counter key used to show a badge in the sidebar. */
  counter?: NavCounterKey;
  /** Extra words the command palette should match on. */
  keywords?: string[];
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Home',
    items: [{ label: 'Overview', to: '/', icon: LayoutDashboard, access: 'overview', key: 'o', description: 'Queues at a glance' }],
  },
  {
    title: 'Moderation',
    items: [
      { label: 'Ad review', to: '/review', icon: Video, access: 'reviewQueue', key: 'r', counter: 'pendingAdReviews', description: 'Approve or reject creatives' },
      { label: 'Campaigns', to: '/campaigns', icon: Megaphone, access: 'campaigns', key: 'c', counter: 'pendingCampaignReviews', description: 'Moderate campaigns' },
      { label: 'Ad reports', to: '/ad-reports', icon: Flag, access: 'adReports', key: 'p', counter: 'openAdReports', description: 'User-submitted reports' },
      { label: 'App installs', to: '/app-installs', icon: Smartphone, access: 'appInstalls', key: 'i', description: 'Verify install claims' },
    ],
  },
  {
    title: 'People',
    items: [
      { label: 'Users', to: '/users', icon: Users, access: 'users', key: 'u', description: 'Search, suspend, ban' },
      { label: 'KYC queue', to: '/kyc', icon: IdCard, access: 'kyc', key: 'k', counter: 'pendingKyc', description: 'Identity document review', keywords: ['identity', 'fayda', 'id verification', 'documents'] },
      { label: 'Referrals', to: '/referrals', icon: Gift, access: 'referrals', key: 'n', description: 'Invites, bonuses, abuse', keywords: ['invite', 'bonus', 'referrer'] },
      { label: 'Deletion requests', to: '/deletion-requests', icon: UserRoundX, access: 'deletionRequests', key: 'd', counter: 'pendingDeletionRequests', description: 'Account deletion & anonymisation', keywords: ['gdpr', 'data rights', 'anonymise', 'delete account'] },
      { label: 'Advertisers', to: '/advertisers', icon: Building2, access: 'advertisers', key: 'v', counter: 'pendingAdvertiserVerifications', description: 'Verify businesses' },
    ],
  },
  {
    title: 'Risk',
    items: [
      { label: 'Fraud', to: '/fraud', icon: ShieldAlert, access: 'fraud', key: 'f', counter: 'openFraudFlags', description: 'Flags, rings, metrics' },
      { label: 'Alerts', to: '/alerts', icon: BellRing, access: 'alerts', key: 't', counter: 'openAlerts', description: 'Money-day alerts & rules', keywords: ['ledger drift', 'payout failure', 'otp spike', 'spend velocity', 'account minting', 'notifier'] },
    ],
  },
  {
    title: 'Finance',
    items: [
      { label: 'Withdrawals', to: '/withdrawals', icon: Banknote, access: 'withdrawals', key: 'w', counter: 'withdrawalsAwaitingReview', description: 'Payout queue & dual approval' },
      { label: 'Coin adjustments', to: '/adjustments', icon: Coins, access: 'adjustments', key: 'a', counter: 'pendingCoinAdjustments', description: 'Two-step manual credits' },
      { label: 'Revenue', to: '/revenue', icon: Activity, access: 'revenue', key: 'e', description: 'Spend, rewards, take rate' },
    ],
  },
  {
    title: 'System',
    items: [
      { label: 'Audit log', to: '/audit', icon: ScrollText, access: 'audit', key: 'l', description: 'Every admin decision' },
      { label: 'Platform config', to: '/config', icon: Settings2, access: 'config', key: 'g', description: 'Effective settings & mocks' },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

export const VERIFIED_ICON = BadgeCheck;
