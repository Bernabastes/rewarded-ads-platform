import type {
  AdCompletionResult,
  AdDetail,
  AdFeedItem,
  AdFeedMeta,
  CompleteWatchSessionDto,
  HeartbeatDto,
  HeartbeatResponse,
  Paginated,
  PaginationQuery,
  StartWatchSessionDto,
  WatchSessionResponse,
} from '@rap/shared';
import { API_ROUTES } from '@rap/shared';

import { api } from '@/api';

export const adsApi = {
  feed(query: PaginationQuery = {}) {
    return api.get<Paginated<AdFeedItem, AdFeedMeta>>(API_ROUTES.ads.feed, { query });
  },
  detail(adId: string) {
    return api.get<AdDetail>(API_ROUTES.ads.detail(adId));
  },
  startWatchSession(adId: string, dto: StartWatchSessionDto) {
    return api.post<WatchSessionResponse>(API_ROUTES.ads.startWatchSession(adId), dto);
  },
  heartbeat(sessionId: string, dto: HeartbeatDto = {}) {
    return api.post<HeartbeatResponse>(API_ROUTES.ads.heartbeat(sessionId), dto, { timeoutMs: 8000 });
  },
  complete(sessionId: string, dto: CompleteWatchSessionDto = {}) {
    return api.post<AdCompletionResult>(API_ROUTES.ads.complete(sessionId), dto);
  },
};
