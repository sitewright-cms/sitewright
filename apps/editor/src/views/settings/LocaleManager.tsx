import { useState } from 'react';
import { api } from '../../api';
import { useDialogs } from '../ui/Dialogs';
import { LocalePickerModal } from '../i18n/LocalePickerModal';
import { localeFlag, localeLabel } from '../i18n/locale-catalog';
import { ghostButton } from '../../theme';

interface LocaleManagerProps {
  projectId: string;
  /** Configured locales, default first. */
  locales: string[];
  defaultLocale: string;
  /** Called with the new ordered locale list so the parent form stays in sync (no full reload). */
  onChange: (locales: string[]) => void;
  /** Fired after a language is actually added/removed server-side, so the pages list can refresh. */
  onLocalesChanged?: () => void;
  /** Re-hydrate the whole settings form after the main language is changed (default + locales). */
  onReloadSettings?: () => Promise<void> | void;
}

/**
 * Manage a site's translation targets from Website Settings: add a language (scaffolds a
 * variant of every page) or remove one (cascade-deletes its pages, after a warning). The
 * default/main language owns each page's layout and cannot be removed here. Locale add/remove
 * goes through dedicated endpoints; the parent's form locale list is patched locally.
 */
export function LocaleManager({ projectId, locales, defaultLocale, onChange, onLocalesChanged, onReloadSettings }: LocaleManagerProps) {
  const { confirm, dialog } = useDialogs();
  const [addOpen, setAddOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Change the MAIN language by re-labelling it (server enforces: the target must NOT be an active
  // locale). The default-language content keeps its pages/datasets and just becomes `locale`; the old
  // default is replaced in the list. Nothing is translated. Re-hydrates the form on success.
  async function changeDefault(locale: string) {
    setChangeOpen(false);
    setError(null);
    const ok = await confirm({
      title: `Make ${localeLabel(locale)} the main language?`,
      message:
        `Your main-language content keeps its text but is re-labelled ${localeLabel(locale)} (${locale}), ` +
        `replacing ${localeLabel(defaultLocale)} (${defaultLocale}) as the site's main language. ` +
        `Nothing is translated and your other languages are unaffected. ` +
        `Any unsaved settings changes will be discarded.`,
      confirmLabel: 'Change main language',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.setDefaultLocale(projectId, locale);
      await onReloadSettings?.();
      onLocalesChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to change the main language');
    } finally {
      setBusy(false);
    }
  }

  async function add(locale: string) {
    setError(null);
    setBusy(true);
    try {
      await api.addLocale(projectId, locale);
      setAddOpen(false);
      onChange([...locales, locale]);
      onLocalesChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to add language');
    } finally {
      setBusy(false);
    }
  }

  async function remove(locale: string) {
    setError(null);
    // Count the pages that will be deleted, for a precise warning.
    let count = 0;
    try {
      const res = await api.listPages(projectId);
      count = res.items.filter((p) => (p.locale ?? defaultLocale) === locale).length;
    } catch {
      /* fall back to a generic warning */
    }
    const ok = await confirm({
      title: `Remove ${localeLabel(locale)}?`,
      message:
        `Removing ${localeLabel(locale)} (${locale}) permanently deletes ` +
        `${count > 0 ? `all ${count} page${count === 1 ? '' : 's'}` : 'every page'} in that language. ` +
        `This cannot be undone.`,
      confirmLabel: 'Remove language',
    });
    if (!ok) return;
    try {
      await api.removeLocale(projectId, locale);
      onChange(locales.filter((l) => l !== locale));
      onLocalesChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to remove language');
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {dialog}
      <p className="text-xs text-slate-500">
        Languages this site is available in. The main language owns each page’s layout; the others follow it
        (or fork their own). Removing a language deletes all of its pages.
      </p>
      <ul className="flex flex-col gap-1.5">
        {locales.map((loc) => (
          <li key={loc} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white/60 px-3 py-2">
            <span aria-hidden className="text-lg">{localeFlag(loc)}</span>
            <span className="text-sm font-medium text-slate-800">{localeLabel(loc)}</span>
            <span className="font-mono text-xs uppercase text-slate-400">{loc}</span>
            {loc === defaultLocale ? (
              <span className="ml-auto flex items-center gap-2">
                <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-medium text-indigo-700">main language</span>
                <button
                  type="button"
                  disabled={busy}
                  className="text-sm font-medium text-indigo-600 transition hover:text-indigo-700 disabled:opacity-50"
                  onClick={() => {
                    setError(null);
                    setChangeOpen(true);
                  }}
                >
                  Change
                </button>
              </span>
            ) : (
              <button
                type="button"
                aria-label={`Remove ${localeLabel(loc)}`}
                className="ml-auto text-sm font-medium text-rose-600 transition hover:text-rose-700"
                onClick={() => void remove(loc)}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      <div>
        <button
          type="button"
          className={ghostButton}
          onClick={() => {
            setError(null);
            setAddOpen(true);
          }}
        >
          + Add language
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {changeOpen && (
        <LocalePickerModal
          title="Change the main language"
          description="Pick the language your site's main content is actually in. It must be a language you haven't added as a translation yet — this re-labels the main language, it doesn't translate anything."
          actionLabel="Set as main language"
          exclude={locales}
          busy={busy}
          error={error}
          onPick={(l) => void changeDefault(l)}
          onClose={() => {
            if (!busy) setChangeOpen(false);
          }}
        />
      )}
      {addOpen && (
        <LocalePickerModal
          title="Add a language"
          description="Pick a language to translate this site into. Every page is duplicated into it, following the main language's layout."
          actionLabel="Add language"
          exclude={locales}
          busy={busy}
          error={error}
          onPick={(l) => void add(l)}
          onClose={() => {
            if (!busy) setAddOpen(false);
          }}
        />
      )}
    </div>
  );
}
