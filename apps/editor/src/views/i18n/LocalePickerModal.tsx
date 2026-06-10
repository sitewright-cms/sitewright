import { useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { glassInput, primaryButton, gradientHover } from '../../theme';
import { LOCALE_CATALOG, localeFlag, validateLocale } from './locale-catalog';

interface LocalePickerModalProps {
  /** Modal title (e.g. "Add a translation target"). */
  title: string;
  /** A short explanation rendered under the title. */
  description?: string;
  /** Locale codes to hide from the catalog (e.g. languages already configured). */
  exclude?: string[];
  /** Label for the action (default "Add"). */
  actionLabel?: string;
  /** True while the parent is applying the pick (disables input + shows progress). */
  busy?: boolean;
  /** Error surfaced from the parent's apply (e.g. the locale already exists). */
  error?: string | null;
  /** Called with the chosen locale tag (catalog entry or a custom one). */
  onPick: (locale: string) => void;
  onClose: () => void;
}

/**
 * A searchable locale picker (catalog + custom tag) shared by "Add translation" and the
 * admin "default locale for new projects". The parent owns the async apply (api call) via
 * `onPick`, passing `busy`/`error` back in.
 */
export function LocalePickerModal({
  title,
  description,
  exclude = [],
  actionLabel = 'Add',
  busy = false,
  error,
  onPick,
  onClose,
}: LocalePickerModalProps) {
  const [query, setQuery] = useState('');
  const [custom, setCustom] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);

  const excluded = useMemo(() => new Set(exclude.map((l) => l.toLowerCase())), [exclude]);
  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      LOCALE_CATALOG.filter((l) => !excluded.has(l.code.toLowerCase())).filter(
        (l) => !q || l.name.toLowerCase().includes(q) || l.code.toLowerCase().includes(q),
      ),
    [excluded, q],
  );

  function pickCustom() {
    const { locale, error: err } = validateLocale(custom);
    if (!locale) {
      setCustomError(err ?? 'Invalid locale.');
      return;
    }
    if (excluded.has(locale.toLowerCase())) {
      setCustomError(`"${locale}" is already configured.`);
      return;
    }
    setCustomError(null);
    onPick(locale);
  }

  return (
    <Modal title={title} size="md" onClose={onClose}>
      <div className="flex flex-col gap-3 p-5">
        {description && <p className="text-sm text-slate-500">{description}</p>}
        <input
          aria-label="Search languages"
          className={glassInput}
          placeholder="Search languages…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={busy}
          autoFocus
        />
        <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto pr-1">
          {shown.map((l) => (
            <li key={l.code}>
              <button
                type="button"
                disabled={busy}
                className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition disabled:opacity-50 ${gradientHover}`}
                onClick={() => onPick(l.code)}
              >
                <span aria-hidden className="text-lg">{l.flag}</span>
                <span className="font-medium text-slate-800 group-hover:text-white">{l.name}</span>
                <span className="ml-auto font-mono text-xs uppercase text-slate-400 group-hover:text-white/80">{l.code}</span>
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">No matching language — add a custom one below.</li>}
        </ul>

        <div className="mt-1 border-t border-slate-200/70 pt-3">
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">Custom locale</label>
          <div className="flex items-center gap-2">
            <span aria-hidden className="text-lg">{localeFlag(custom || 'xx')}</span>
            <input
              aria-label="Custom locale code"
              className={glassInput}
              placeholder="e.g. pt-BR"
              value={custom}
              onChange={(e) => {
                setCustom(e.target.value);
                setCustomError(null);
              }}
              disabled={busy}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  pickCustom();
                }
              }}
            />
            <button type="button" className={primaryButton} onClick={pickCustom} disabled={busy || !custom.trim()}>
              {actionLabel}
            </button>
          </div>
          {customError && <p className="mt-1 text-sm text-red-600">{customError}</p>}
        </div>

        {busy && (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <span className="loading loading-spinner loading-xs" aria-hidden /> Working…
          </p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}
