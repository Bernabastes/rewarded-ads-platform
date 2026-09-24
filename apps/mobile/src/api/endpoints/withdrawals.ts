import type {
  CreateWithdrawalDto,
  Paginated,
  PaginationQuery,
  WithdrawalConfig,
  WithdrawalItem,
  WithdrawalStatus,
} from '@rap/shared';
import { API_ROUTES } from '@rap/shared';

import { api } from '@/api';

export const withdrawalsApi = {
  config() {
    return api.get<WithdrawalConfig>(API_ROUTES.withdrawals.config);
  },
  create(dto: CreateWithdrawalDto) {
    return api.post<WithdrawalItem>(API_ROUTES.withdrawals.create, dto);
  },
  list(query: PaginationQuery & { status?: WithdrawalStatus } = {}) {
    return api.get<Paginated<WithdrawalItem>>(API_ROUTES.withdrawals.list, { query });
  },
  detail(id: string) {
    return api.get<WithdrawalItem>(API_ROUTES.withdrawals.detail(id));
  },
};
