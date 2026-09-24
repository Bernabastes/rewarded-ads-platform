import type {
  AdReport,
  BalanceResponse,
  CreateAdReportDto,
  LedgerEntry,
  NotificationItem,
  Paginated,
  PaginationQuery,
  RegisterPushTokenDto,
  UpdateProfileDto,
  UserProfile,
  UserSummary,
} from '@rap/shared';
import { API_ROUTES } from '@rap/shared';

import { api } from '@/api';

export const usersApi = {
  me() {
    return api.get<UserProfile>(API_ROUTES.users.me);
  },
  update(dto: UpdateProfileDto) {
    return api.patch<UserProfile>(API_ROUTES.users.me, dto);
  },
  summary() {
    return api.get<UserSummary>(API_ROUTES.users.summary);
  },
  balance() {
    return api.get<BalanceResponse>(API_ROUTES.users.balance);
  },
  ledger(query: PaginationQuery = {}) {
    return api.get<Paginated<LedgerEntry>>(API_ROUTES.users.ledger, { query });
  },
  notifications(query: PaginationQuery = {}) {
    return api.get<Paginated<NotificationItem>>(API_ROUTES.users.notifications, { query });
  },
  markNotificationRead(id: string) {
    return api.post<NotificationItem | undefined>(API_ROUTES.users.notificationRead(id));
  },
  registerPushToken(dto: RegisterPushTokenDto) {
    return api.post<unknown>(API_ROUTES.users.pushTokens, dto);
  },
  removePushToken(token: string) {
    return api.delete<void>(API_ROUTES.users.pushToken(token));
  },
  reportAd(dto: CreateAdReportDto) {
    return api.post<AdReport>(API_ROUTES.users.adReports, dto);
  },
};
