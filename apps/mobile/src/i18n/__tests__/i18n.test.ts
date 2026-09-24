import am from '../locales/am.json';
import en from '../locales/en.json';
import om from '../locales/om.json';
import ti from '../locales/ti.json';
import { createI18n, getLocale, isSupportedLanguage } from '../index';

type Tree = { [key: string]: string | Tree };

/** Flattens {a:{b:'x'}} -> ['a.b'] and strips i18next plural suffixes so `_one`/`_other` count as one key. */
function keysOf(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') return [path.replace(/_(one|other|zero|two|few|many)$/, '')];
    return keysOf(value as Tree, path);
  });
}
const unique = (list: string[]) => Array.from(new Set(list)).sort();

describe('i18n resources', () => {
  it('Amharic (the default) covers every English key', () => {
    const missing = unique(keysOf(en as Tree)).filter((key) => !unique(keysOf(am as Tree)).includes(key));
    expect(missing).toEqual([]);
  });

  it('English covers every Amharic key (no orphan keys)', () => {
    const missing = unique(keysOf(am as Tree)).filter((key) => !unique(keysOf(en as Tree)).includes(key));
    expect(missing).toEqual([]);
  });

  it('partial languages only use keys that exist in English', () => {
    const enKeys = unique(keysOf(en as Tree));
    for (const partial of [om, ti]) {
      const unknown = unique(keysOf(partial as Tree)).filter((key) => !enKeys.includes(key));
      expect(unknown).toEqual([]);
    }
  });

  it('every interpolation placeholder used in English also appears in the Amharic string', () => {
    const flatten = (tree: Tree, prefix = ''): Record<string, string> =>
      Object.entries(tree).reduce<Record<string, string>>((acc, [key, value]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'string') acc[path] = value;
        else Object.assign(acc, flatten(value as Tree, path));
        return acc;
      }, {});
    const enFlat = flatten(en as Tree);
    const amFlat = flatten(am as Tree);
    const placeholders = (s: string) => unique(Array.from(s.matchAll(/\{\{\s*(\w+)/g), (m) => m[1]));
    const problems: string[] = [];
    for (const [key, value] of Object.entries(enFlat)) {
      const amKey = key.replace(/_(one|other)$/, '');
      const amValue = amFlat[amKey] ?? amFlat[key];
      if (!amValue) continue;
      const missing = placeholders(value).filter((p) => !placeholders(amValue).includes(p));
      if (missing.length) problems.push(`${key}: ${missing.join(',')}`);
    }
    expect(problems).toEqual([]);
  });
});

describe('i18n runtime', () => {
  it('defaults to Amharic', () => {
    const i18n = createI18n();
    expect(i18n.language).toBe('am');
    expect(i18n.t('tabs.wallet')).toBe('ቦርሳ');
  });

  it('falls back om -> am -> en for missing keys', () => {
    const i18n = createI18n('om');
    expect(i18n.t('common.continue')).toBe('Itti fufi');
    // Not translated in om: falls back to Amharic.
    expect(i18n.t('wallet.title')).toBe('ቦርሳ');
  });

  it('falls back ti -> am', () => {
    const i18n = createI18n('ti');
    expect(i18n.t('tabs.home')).toBe('መበገሲ');
    expect(i18n.t('withdraw.title')).toBe('ገንዘብ ያውጡ');
  });

  it('formats coin counts with plural rules and thousands separators', () => {
    const en = createI18n('en');
    expect(en.t('money.coins', { count: 1 })).toBe('1 coin');
    expect(en.t('money.coins', { count: 1250 })).toBe('1,250 coins');
    const am = createI18n('am');
    expect(am.t('money.coins', { count: 1250 })).toBe('1,250 ኮይን');
  });

  it('interpolates without escaping', () => {
    const i18n = createI18n('en');
    expect(i18n.t('home.greetingWithName', { greeting: 'Good morning', name: "Abebe D'Souza" })).toBe(
      "Good morning, Abebe D'Souza",
    );
  });

  it('exposes locale helpers', () => {
    expect(isSupportedLanguage('am')).toBe(true);
    expect(isSupportedLanguage('fr')).toBe(false);
    expect(getLocale('am')).toBe('am-ET');
  });
});
