import type {
  AdReportReason,
  AdReportStatus,
  CompletionStatus,
  DevicePlatform,
  Language,
  LedgerSourceType,
  MediaType,
  NotificationType,
  PushStatus,
  WatchSessionStatus,
} from '../enums';
import type { NotificationPrefs } from './auth';
import type { IsoDateTime, Uuid } from './common';

export interface UpdateProfileDto {
  fullName?: string;
  languagePreference?: Language;
  notificationPrefs?: Partial<NotificationPrefs>;
}

export interface RegisterPushTokenDto {
  token: string;
  platform: DevicePlatform;
  deviceId?: string;
}

export interface BalanceResponse {
  coinBalance: number;
  /** coinBalance / coinsPerEtb, 2 decimals. */
  etbEquivalent: number;
  coinsPerEtb: number;
  /** Server-side integrity check of the cached balance against the append-only ledger. */
  ledgerChecksum: {
    entries: number;
    ledgerSum: number;
    consistent: boolean;
  };
  /** Human-readable conversion note for the wallet screen (English; localise on the client). */
  conversionNote: string;
}

export interface LedgerEntry {
  id: Uuid;
  /** Signed coins. Negative for withdrawals / negative adjustments. */
  amount: number;
  balanceAfter: number;
  sourceType: LedgerSourceType;
  sourceId: Uuid | null;
  description: string | null;
  createdAt: IsoDateTime;
}

export interface UserSummary {
  coinBalance: number;
  etbEquivalent: number;
  todayCompletions: number;
  dailyLimit: number;
  dailyRemaining: number;
  totalEarnedCoins: number;
  totalWithdrawnEtb: number;
  pendingWithdrawalsEtb: number;
  unreadNotifications: number;
  availableAds: number;
  availableOffers: number;
}

export interface NotificationItem {
  id: Uuid;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  readAt: IsoDateTime | null;
  pushStatus: PushStatus;
  createdAt: IsoDateTime;
}

export interface CreateAdReportDto {
  adId: Uuid;
  reason: AdReportReason;
  details?: string;
}

export interface AdReport {
  id: Uuid;
  adId: Uuid;
  userId: Uuid;
  reason: AdReportReason;
  details: string | null;
  status: AdReportStatus;
  createdAt: IsoDateTime;
}

/** One entry of GET /users/me/recently-watched ({ data: RecentlyWatchedItem[] }). */
export interface RecentlyWatchedItem {
  adId: Uuid;
  title: string;
  advertiserName: string;
  thumbnailUrl: string | null;
  mediaType: MediaType;
  durationSeconds: number;
  lastWatchedAt: IsoDateTime;
  sessionStatus: WatchSessionStatus;
  completionStatus: CompletionStatus | null;
  coinReward: number;
  /** true when the user already reported this ad. */
  reported: boolean;
}

export interface RecentlyWatchedResponse {
  data: RecentlyWatchedItem[];
}
