import { Languages, RotateCcw, Trash2 } from 'lucide-react';
import { jsonEqual } from '@sitewright/core';
import { localeLabel } from '../i18n/locale-catalog';
import { ghostButton, gradientSurface } from '../../theme';
import { Tooltip } from '../ui/Tooltip';

/**
 * The language switch of a dataset entry, on a site with more than one language.
 *
 * An entry's other languages store only the fields that DIFFER (`entry.translations[locale]`); every
 * other field follows the main language. So a language tab shows each field's main-language content
 * until it is changed there, and says which fields are the language's own — a price or photo left alone
 * keeps following the main one, which is the point: it is entered once.
 */

/** The fields a language has changed — only what differs from the main language (`values`). */
export function changedFields(values: Readonly<Record<string, unknown>>, own: Readonly<Record<string, unknown>> | undefined): Set<string> {
  const out = new Set<string>();
  for (const [name, value] of Object.entries(own ?? {})) {
    if (!(Object.hasOwn(values, name) && jsonEqual(value, values[name]))) out.add(name);
  }
  return out;
}

/** Main | Deutsch | Français … — a dot marks a language this entry has a version in. */
export function EntryLanguageTabs({
  main,
  others,
  active,
  translated,
  onSelect,
}: {
  main: string;
  others: readonly string[];
  /** `null` = the main language. */
  active: string | null;
  translated: ReadonlySet<string>;
  onSelect: (locale: string | null) => void;
}) {
  const tab = (locale: string | null, label: string, hint: string) => (
    <button
      key={locale ?? ''}
      type="button"
      role="tab"
      aria-selected={active === locale}
      title={hint}
      onClick={() => onSelect(locale)}
      className={`waves-effect flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs transition ${
        active === locale ? `${gradientSurface} font-bold` : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
      }`}
    >
      {label}
      {locale !== null && (
        <span
          aria-hidden
          className={`h-1.5 w-1.5 rounded-full ${translated.has(locale) ? 'bg-emerald-500' : 'border border-slate-400 dark:border-slate-500'}`}
        />
      )}
    </button>
  );
  return (
    <div className="flex items-center gap-2">
      <Languages aria-hidden className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
      <div
        role="tablist"
        aria-label="Entry language"
        className="flex flex-wrap items-center gap-0.5 rounded-xl border border-white/60 dark:border-white/10 bg-white/50 dark:bg-white/5 p-0.5 shadow-sm"
      >
        {tab(null, `${localeLabel(main)} · main`, 'The entry’s own content — every language follows it unless changed there')}
        {others.map((l) =>
          tab(l, localeLabel(l), translated.has(l) ? `Has a ${localeLabel(l)} version` : `No ${localeLabel(l)} version yet — shows in ${localeLabel(main)}`),
        )}
      </div>
    </div>
  );
}

/** A language this entry has no version in: what that means on the site, and the way to start one. */
export function UntranslatedNotice({ locale, main, onTranslate }: { locale: string; main: string; onTranslate: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-slate-300 dark:border-white/15 p-4 text-sm text-slate-600 dark:text-slate-300">
      <p>
        No {localeLabel(locale)} version yet — on {localeLabel(locale)} pages this entry shows its {localeLabel(main)} content.
      </p>
      <button type="button" className={`waves-effect rounded-lg px-3 py-1.5 text-xs font-bold ${gradientSurface}`} onClick={onTranslate}>
        Translate to {localeLabel(locale)}
      </button>
    </div>
  );
}

/** A language this entry has a version in: how its fields relate to the main language, and removing it. */
export function TranslationNotice({ locale, main, onRemove }: { locale: string; main: string; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 px-3 py-2 text-[11px] text-indigo-800 dark:text-indigo-200">
      <p className="flex-1">
        Change what differs in {localeLabel(locale)}. A field you leave as it is follows {localeLabel(main)} — change it there and it changes here too.
      </p>
      <button type="button" className={`${ghostButton} flex shrink-0 items-center gap-1 px-2 py-1 text-[11px]`} onClick={onRemove}>
        <Trash2 aria-hidden className="h-3.5 w-3.5" />
        Remove {localeLabel(locale)} version
      </button>
    </div>
  );
}

/** Beside a field on a language tab: its own value there, or the main language's. */
export function FieldLanguageBadge({ changed, main, field, onReset }: { changed: boolean; main: string; field: string; onReset: () => void }) {
  if (!changed) {
    return <span className="ml-auto text-[10px] text-slate-500 dark:text-slate-400">same as {localeLabel(main)}</span>;
  }
  return (
    <span className="ml-auto flex items-center gap-1 text-[10px] font-medium text-indigo-600 dark:text-indigo-300">
      changed
      <Tooltip tip={`Use the ${localeLabel(main)} value again`}>
        <button type="button" aria-label={`Reset ${field} to ${localeLabel(main)}`} className={`${ghostButton} px-1 py-0.5`} onClick={onReset}>
          <RotateCcw aria-hidden className="h-3 w-3" />
        </button>
      </Tooltip>
    </span>
  );
}
