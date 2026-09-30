import type {
  AcceptConsentDto,
  AdReport,
  BalanceResponse,
  CreateAdReportDto,
  CreateDeletionRequestDto,
  CreateKycSubmissionDto,
  DataExportItem,
  DeletionRequestItem,
  KycPresignDto,
  KycSubmissionItem,
  LedgerEntry,
  LegalDocumentKind,
  MyKycResponse,
  MyReferralsResponse,
  NotificationItem,
  Paginated,
  PaginationQuery,
  PresignUploadResponse,
  RegisterPushTokenDto,
  UpdateProfileDto,
  UserConsentState,
  UserProfile,
  UserSummary,
} from '@rap/shared';
import { API_ROUTES } from '@rap/shared';

import { api } from '@/api';

/** `GET/POST /users/me/consents` */
export interface ConsentStateResponse {
  consents: UserConsentState[];
  requiresConsent: LegalDocumentKind[];
}

/** `POST /users/me/kyc/uploads/presign` - the campaign presign shape plus the echoed `kind`. */
export type KycPresignResponse = PresignUploadResponse & { kind: string };

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

  /* ---------- legal / consent ---------- */
  consents() {
    return api.get<ConsentStateResponse>(API_ROUTES.users.consents);
  },
  acceptConsent(dto: AcceptConsentDto) {
    return api.post<ConsentStateResponse>(API_ROUTES.users.consents, dto);
  },

  /* ---------- KYC ---------- */
  kyc() {
    return api.get<MyKycResponse>(API_ROUTES.users.kyc);
  },
  kycPresign(dto: KycPresignDto) {
    return api.post<KycPresignResponse>(API_ROUTES.users.kycPresign, dto);
  },
  submitKyc(dto: CreateKycSubmissionDto) {
    return api.post<KycSubmissionItem>(API_ROUTES.users.kyc, dto);
  },

  /* ---------- referrals ---------- */
  referrals() {
    return api.get<MyReferralsResponse>(API_ROUTES.users.referrals);
  },

  /* ---------- data rights ---------- */
  requestDataExport() {
    return api.post<DataExportItem>(API_ROUTES.users.dataExport);
  },
  dataExports() {
    return api.get<{ data: DataExportItem[] }>(API_ROUTES.users.dataExport);
  },
  dataExport(id: string) {
    return api.get<DataExportItem>(API_ROUTES.users.dataExportDetail(id));
  },
  requestDeletion(dto: CreateDeletionRequestDto = {}) {
    return api.post<DeletionRequestItem>(API_ROUTES.users.deleteRequest, dto);
  },
  /** Latest deletion request; the API answers 200 with an empty body when there is none. */
  async deletionRequest(): Promise<DeletionRequestItem | null> {
    const item = await api.get<DeletionRequestItem | undefined>(API_ROUTES.users.deleteRequest);
    return item ?? null;
  },
  cancelDeletion() {
    return api.delete<DeletionRequestItem | undefined>(API_ROUTES.users.deleteRequest);
  },
};
