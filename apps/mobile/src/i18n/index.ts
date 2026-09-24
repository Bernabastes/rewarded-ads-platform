import type { Language } from '@rap/shared';
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES } from '@rap/shared';
import i18next, { type i18n as I18nInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

import am from './locales/am.json';
import en from './locales/en.json';
import om from './locales/om.json';
import ti from './locales/ti.json';

export const resources = {
  am: { translation: am },
  en: { translation: en },
  om: { translation: om },
  ti: { translation: ti },
} as const;

/**
 * Fallback chain: Afaan Oromo and Tigrinya are partially translated and fall back to Amharic
 * (the product default), which in turn falls back to English for any key that is still missing.
 */
export const FALLBACK_LANGUAGES: Record<string, string[]> = {
  om: ['am', 'en'],
  ti: ['am', 'en'],
  en: ['am'],
  default: ['am', 'en'],
};

export const LANGUAGE_LOCALES: Record<Language, string> = {
  am: 'am-ET',
  en: 'en-ET',
  om: 'om-ET',
  ti: 'ti-ET',
};

export const LANGUAGE_NAMES: Record<Language, string> = {
  am: 'አማርኛ',
  en: 'English',
  om: 'Afaan Oromoo',
  ti: 'ትግርኛ',
};

export function isSupportedLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

export function createI18n(language: Language = DEFAULT_LANGUAGE): I18nInstance {
  const instance = i18next.createInstance();
  instance.use(initReactI18next);
  // initReactI18next is synchronous with bundled resources; init() returns a promise we do not need to await.
  void instance.init({
    resources,
    lng: language,
    fallbackLng: FALLBACK_LANGUAGES,
    supportedLngs: [...SUPPORTED_LANGUAGES],
    interpolation: { escapeValue: false },
    returnNull: false,
    returnEmptyString: false,
    initAsync: false,
  });
  return instance;
}

export const i18n = createI18n();

export function getCurrentLanguage(instance: I18nInstance = i18n): Language {
  return isSupportedLanguage(instance.language) ? instance.language : DEFAULT_LANGUAGE;
}

export function getLocale(language: Language = getCurrentLanguage()): string {
  return LANGUAGE_LOCALES[language];
}
