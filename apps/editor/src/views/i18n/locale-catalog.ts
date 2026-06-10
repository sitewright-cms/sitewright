// A catalog of common locales for the language pickers (Add translation + the admin
// "default locale for new projects"). Not exhaustive — any tag the catalog lacks can be
// entered as a custom locale (validated by LOCALE_RE). Flags are emoji so they need no
// assets; a tag with a region subtag (e.g. `pt-BR`) derives its flag from the region.

export interface LocaleInfo {
  /** The BCP-47-ish tag stored as the page/project locale. */
  code: string;
  /** English display name. */
  name: string;
  /** Flag emoji shown in the switcher/picker. */
  flag: string;
}

/** The locale tag validity rule (mirrors LocaleSchema in @sitewright/schema). */
export const LOCALE_RE = /^[A-Za-z0-9-]+$/;
export const LOCALE_MAX = 35;

// A representative flag per language (language ≠ country, so these are best-effort).
export const LOCALE_CATALOG: LocaleInfo[] = [
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'en-US', name: 'English (US)', flag: '🇺🇸' },
  { code: 'de', name: 'German', flag: '🇩🇪' },
  { code: 'fr', name: 'French', flag: '🇫🇷' },
  { code: 'es', name: 'Spanish', flag: '🇪🇸' },
  { code: 'it', name: 'Italian', flag: '🇮🇹' },
  { code: 'pt', name: 'Portuguese', flag: '🇵🇹' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)', flag: '🇧🇷' },
  { code: 'nl', name: 'Dutch', flag: '🇳🇱' },
  { code: 'pl', name: 'Polish', flag: '🇵🇱' },
  { code: 'ru', name: 'Russian', flag: '🇷🇺' },
  { code: 'uk', name: 'Ukrainian', flag: '🇺🇦' },
  { code: 'cs', name: 'Czech', flag: '🇨🇿' },
  { code: 'sk', name: 'Slovak', flag: '🇸🇰' },
  { code: 'hu', name: 'Hungarian', flag: '🇭🇺' },
  { code: 'ro', name: 'Romanian', flag: '🇷🇴' },
  { code: 'bg', name: 'Bulgarian', flag: '🇧🇬' },
  { code: 'el', name: 'Greek', flag: '🇬🇷' },
  { code: 'tr', name: 'Turkish', flag: '🇹🇷' },
  { code: 'sv', name: 'Swedish', flag: '🇸🇪' },
  { code: 'no', name: 'Norwegian', flag: '🇳🇴' },
  { code: 'da', name: 'Danish', flag: '🇩🇰' },
  { code: 'fi', name: 'Finnish', flag: '🇫🇮' },
  { code: 'is', name: 'Icelandic', flag: '🇮🇸' },
  { code: 'et', name: 'Estonian', flag: '🇪🇪' },
  { code: 'lv', name: 'Latvian', flag: '🇱🇻' },
  { code: 'lt', name: 'Lithuanian', flag: '🇱🇹' },
  { code: 'hr', name: 'Croatian', flag: '🇭🇷' },
  { code: 'sl', name: 'Slovenian', flag: '🇸🇮' },
  { code: 'sr', name: 'Serbian', flag: '🇷🇸' },
  { code: 'ca', name: 'Catalan', flag: '🇪🇸' },
  { code: 'ga', name: 'Irish', flag: '🇮🇪' },
  { code: 'ar', name: 'Arabic', flag: '🇸🇦' },
  { code: 'he', name: 'Hebrew', flag: '🇮🇱' },
  { code: 'fa', name: 'Persian', flag: '🇮🇷' },
  { code: 'hi', name: 'Hindi', flag: '🇮🇳' },
  { code: 'th', name: 'Thai', flag: '🇹🇭' },
  { code: 'vi', name: 'Vietnamese', flag: '🇻🇳' },
  { code: 'id', name: 'Indonesian', flag: '🇮🇩' },
  { code: 'ms', name: 'Malay', flag: '🇲🇾' },
  { code: 'ja', name: 'Japanese', flag: '🇯🇵' },
  { code: 'ko', name: 'Korean', flag: '🇰🇷' },
  { code: 'zh', name: 'Chinese', flag: '🇨🇳' },
  { code: 'zh-TW', name: 'Chinese (Traditional)', flag: '🇹🇼' },
];

const BY_CODE = new Map(LOCALE_CATALOG.map((l) => [l.code.toLowerCase(), l]));

/** Catalog entry for a tag (case-insensitive), or undefined for an unlisted/custom one. */
export function localeInfo(code: string): LocaleInfo | undefined {
  return BY_CODE.get(code.toLowerCase());
}

/** Display name for a tag — the catalog name, else the tag itself. */
export function localeLabel(code: string): string {
  return localeInfo(code)?.name ?? code;
}

/** Two-letter region code → its flag emoji (regional-indicator pair). */
function regionToFlag(region: string): string {
  const cc = region.toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return '🌐';
  const base = 0x1f1e6; // 🇦
  return String.fromCodePoint(base + cc.charCodeAt(0) - 65, base + cc.charCodeAt(1) - 65);
}

/** Flag emoji for a tag: the catalog flag, else derived from a region subtag, else a globe. */
export function localeFlag(code: string): string {
  const info = localeInfo(code);
  if (info) return info.flag;
  const region = code.split('-')[1];
  if (region) return regionToFlag(region);
  return '🌐';
}

/** Validate + normalize a custom locale tag the user typed; returns the trimmed tag or an error. */
export function validateLocale(raw: string): { locale?: string; error?: string } {
  const locale = raw.trim();
  if (!locale) return { error: 'Enter a locale code (e.g. de, pt-BR).' };
  if (locale.length > LOCALE_MAX) return { error: `A locale code is at most ${LOCALE_MAX} characters.` };
  if (!LOCALE_RE.test(locale)) return { error: 'Use letters, digits and hyphens only (e.g. de, pt-BR).' };
  return { locale };
}
