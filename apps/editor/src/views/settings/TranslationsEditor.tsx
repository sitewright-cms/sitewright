import { Plus, Trash2 } from 'lucide-react';
import { localeFlag, localeLabel } from '../i18n/locale-catalog';
import { newTranslationRow, type TranslationRow } from './model';
import { ghostButton, glassInput } from '../../theme';

interface TranslationsEditorProps {
  rows: TranslationRow[];
  /** Configured locales (default first) — the editable columns of the grid. */
  localeCodes: string[];
  defaultLocale: string;
  onChange: (rows: TranslationRow[]) => void;
}

/** Own-property read of a cell value (proto-safe, satisfies no-object-injection). */
function cellValue(cells: Record<string, string>, locale: string): string {
  // eslint-disable-next-line security/detect-object-injection -- own-property guarded; locale is a configured code
  return (Object.prototype.hasOwnProperty.call(cells, locale) ? cells[locale] : '') ?? '';
}

/**
 * The project i18n MESSAGE CATALOG editor — a key × locale grid over `website.translations`. Each row is
 * a flat identifier key; each column is a CONFIGURED locale (driven by the localization settings, so
 * adding/removing a language adds/removes a column). The `{{sw-translate "key"}}` helper and the
 * `data-sw-translate="key"` directive both read these; empty cells fall back to the main language.
 */
export function TranslationsEditor({ rows, localeCodes, defaultLocale, onChange }: TranslationsEditorProps) {
  const setKey = (id: string, key: string): void => onChange(rows.map((r) => (r.id === id ? { ...r, key } : r)));
  const setCell = (id: string, locale: string, value: string): void =>
    onChange(rows.map((r) => (r.id === id ? { ...r, cells: { ...r.cells, [locale]: value } } : r)));
  const add = (): void => onChange([...rows, newTranslationRow()]);
  const remove = (id: string): void => onChange(rows.filter((r) => r.id !== id));

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-slate-500">
        Site-wide phrases shared across every page and language. Reference one with{' '}
        <code>{'{{sw-translate "key"}}'}</code> in a slot/template, or make any element editable in the live
        preview with <code>data-sw-translate=&quot;key&quot;</code>. Empty cells fall back to the main language.
      </p>
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-1 text-sm">
            <thead>
              <tr>
                <th className="px-1 text-left text-xs font-medium text-slate-500">Key</th>
                {localeCodes.map((loc) => (
                  <th key={loc} className="px-1 text-left text-xs font-medium text-slate-500">
                    <span aria-hidden className="mr-1">
                      {localeFlag(loc)}
                    </span>
                    <span className="font-mono uppercase">{loc}</span>
                    {loc === defaultLocale && <span className="ml-1 font-normal text-slate-400">(main)</span>}
                  </th>
                ))}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="align-top">
                    <input
                      className={`${glassInput} font-mono`}
                      value={row.key}
                      onChange={(e) => setKey(row.id, e.target.value)}
                      placeholder="nav_cta"
                      aria-label="Translation key"
                    />
                  </td>
                  {localeCodes.map((loc) => (
                    <td key={loc} className="align-top">
                      <input
                        className={glassInput}
                        value={cellValue(row.cells, loc)}
                        onChange={(e) => setCell(row.id, loc, e.target.value)}
                        placeholder={localeLabel(loc)}
                        aria-label={`${row.key || 'translation'} — ${loc}`}
                      />
                    </td>
                  ))}
                  <td className="align-top">
                    <button
                      type="button"
                      aria-label="Remove translation"
                      onClick={() => remove(row.id)}
                      className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div>
        <button type="button" className={ghostButton} onClick={add}>
          <Plus className="mr-1 inline h-4 w-4" /> Add translation
        </button>
      </div>
    </div>
  );
}
