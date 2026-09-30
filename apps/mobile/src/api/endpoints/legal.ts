import type { CurrentLegalDocumentsResponse, Language } from '@rap/shared';
import { API_ROUTES } from '@rap/shared';

import { api } from '@/api';

export const legalApi = {
  /** Public: one current document per kind (`terms`, `privacy`) in the requested locale (falls back to `en`). */
  current(locale: Language) {
    return api.get<CurrentLegalDocumentsResponse>(API_ROUTES.legal.current, {
      query: { locale, audience: 'user' },
      auth: false,
    });
  },
};
