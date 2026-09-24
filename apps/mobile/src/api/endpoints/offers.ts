import type {
  AppInstallOfferDetail,
  CompleteAppInstallDto,
  CompleteSurveyDto,
  OfferCompletionHistoryItem,
  OfferCompletionResult,
  OfferListItem,
  OfferType,
  Paginated,
  PaginationQuery,
  SurveyDetail,
} from '@rap/shared';
import { API_ROUTES } from '@rap/shared';

import { api } from '@/api';

export const offersApi = {
  list(query: PaginationQuery & { type?: OfferType } = {}) {
    return api.get<Paginated<OfferListItem>>(API_ROUTES.offers.list, { query });
  },
  survey(id: string) {
    return api.get<SurveyDetail>(API_ROUTES.offers.survey(id));
  },
  completeSurvey(id: string, dto: CompleteSurveyDto) {
    return api.post<OfferCompletionResult>(API_ROUTES.offers.surveyComplete(id), dto);
  },
  appInstall(id: string) {
    return api.get<AppInstallOfferDetail>(API_ROUTES.offers.appInstall(id));
  },
  completeAppInstall(id: string, dto: CompleteAppInstallDto) {
    return api.post<OfferCompletionResult>(API_ROUTES.offers.appInstallComplete(id), dto);
  },
  myCompletions(query: PaginationQuery = {}) {
    return api.get<Paginated<OfferCompletionHistoryItem>>(API_ROUTES.offers.myCompletions, { query });
  },
};
