import { COUNTRY_CODES, RANK_LANGUAGES } from '@sitewright/schema';
import type { SelectOption } from '../ui/SearchableSelect';
import { countryName } from './format';

/**
 * The Country and Language choices of "Add keywords", for `ui/SearchableSelect`. Its search matches an option's
 * label and its `keywords`, so the keywords carry what people actually type besides the English name: the code
 * (`DE`, `pt`), the name without accents (`Cote d'Ivoire`, `Turkiye`), a common other name (`UK`, `Holland`) and a
 * language's own name for itself (`Deutsch`, `español`).
 */

/** `Côte d’Ivoire` → `Cote d’Ivoire`: nobody types the accents into a search box. */
const withoutAccents = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '');

/** Names people search by that `Intl.DisplayNames` does not give. */
const COUNTRY_ALIASES: ReadonlyMap<string, string> = new Map([
  ['AE', 'UAE'],
  ['CI', 'Ivory Coast'],
  ['CZ', 'Czech Republic'],
  ['GB', 'UK Great Britain England Scotland Wales'],
  ['MK', 'Macedonia'],
  ['NL', 'Holland'],
  ['SZ', 'Swaziland'],
  ['TR', 'Turkey'],
  ['US', 'USA America'],
]);

const keywordsOf = (...parts: ReadonlyArray<string | undefined>): string => [...new Set(parts.filter(Boolean))].join(' ');

/** Every country, by English name. */
export const COUNTRY_OPTIONS: readonly SelectOption[] = [...COUNTRY_CODES]
  .map((code) => {
    const name = countryName(code);
    const plain = withoutAccents(name);
    return { value: code, label: name, keywords: keywordsOf(code, plain === name ? undefined : plain, COUNTRY_ALIASES.get(code)) };
  })
  .sort((a, b) => a.label.localeCompare(b.label));

/** A language's name in that language (`de` → `Deutsch`), or nothing where the runtime has no name for it. */
function ownName(code: string): string | undefined {
  try {
    return new Intl.DisplayNames([code], { type: 'language' }).of(code);
  } catch {
    return undefined;
  }
}

/** The search languages, in the schema's order (the common ones first). */
export const LANGUAGE_OPTIONS: readonly SelectOption[] = RANK_LANGUAGES.map((l) => {
  const own = ownName(l.code);
  return { value: l.code, label: l.name, keywords: keywordsOf(l.code, own, own && withoutAccents(own)) };
});
