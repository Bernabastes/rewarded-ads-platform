import type { Language } from '@rap/shared';
import { DEFAULT_LANGUAGE } from '@rap/shared';
import { useTranslation } from 'react-i18next';

import { isSupportedLanguage } from './index';

/** Current UI language as a typed `Language` (falls back to the Amharic default). */
export function useLanguage(): Language {
  const { i18n } = useTranslation();
  return isSupportedLanguage(i18n.language) ? i18n.language : DEFAULT_LANGUAGE;
}
