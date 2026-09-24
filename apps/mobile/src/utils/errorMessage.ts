import type { TFunction } from 'i18next';

import { isApiError } from '@/api/errors';

/** Localises any thrown error on its stable `code` (never on the English server message). */
export function errorMessage(error: unknown, t: TFunction): string {
  if (isApiError(error)) {
    if (error.statusCode === 429) {
      const seconds = error.retryAfterSeconds;
      if (seconds) return t('errors.rateLimited', { seconds });
    }
    const key = `errors.codes.${error.code}`;
    if (t(key, { defaultValue: '' })) return t(key);
    if (error.isNetworkError) return t('errors.network');
    return t('errors.generic');
  }
  if (error instanceof TypeError) return t('errors.network');
  return t('errors.generic');
}
