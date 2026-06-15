import { useState, type ReactNode } from 'react';
import { Plus, Trash2, Pencil, Lock } from 'lucide-react';
import { RESERVED_TRANSLATION_GROUPS, type ReservedTranslation } from '@sitewright/schema';
import { localeFlag, localeLabel } from '../i18n/locale-catalog';
import { newTranslationRow, type TranslationRow } from './model';
import { ghostButton, glassInput } from '../../theme';

interface TranslationsEditorProps {
  rows: TranslationRow[];
  /** Configured locales (default first) — the editable columns of the grid. */
  localeCodes: string[];
  defaultLocale: string;
  /** Whether the shop is enabled — gates the reserved cart-string (shop_cart) ghost rows. */
  shopEnabled?: boolean;
  onChange: (rows: TranslationRow[]) => void;
}

/** Own-property read of a cell value (proto-safe, satisfies no-object-injection). */
function cellValue(cells: Record<string, string>, locale: string): string {
  // eslint-disable-next-line security/detect-object-injection -- own-property guarded; locale is a configured code
  return (Object.prototype.hasOwnProperty.call(cells, locale) ? cells[locale] : '') ?? '';
}

/**
 * The project i18n MESSAGE CATALOG editor — a key × locale grid over `website.translations`. Each row is
 * a flat identifier key; each column is a CONFIGURED locale (driven by localization settings). The
 * `{{sw-translate "key"}}` helper and the `data-sw-translate="key"` directive read these; empty cells
 * fall back to the main language.
 *
 * Two affordances beyond a plain grid:
 *  - RESERVED ghost rows: when a platform feature is on (e.g. the shop) AND there is more than one
 *    locale, the platform's built-in UI strings (RESERVED_TRANSLATION_GROUPS) surface as a grouped,
 *    read-only-key section with the English default shown as a placeholder. The operator just fills the
 *    other-locale cells; the row MATERIALIZES into the catalog on first edit (so the table stays clean
 *    until they actually translate something). No need to know the magic key names.
 *  - KEY protection: a free-form row's key is read-only behind a small pencil toggle, so a careless edit
 *    can't silently rename a key (which would orphan its `{{sw-translate}}` / `data-sw-translate` refs).
 */
export function TranslationsEditor({ rows, localeCodes, defaultLocale, shopEnabled = false, onChange }: TranslationsEditorProps) {
  // Row ids whose KEY is currently unlocked for editing (blank keys are always editable — new rows).
  const [editingKeys, setEditingKeys] = useState<ReadonlySet<string>>(() => new Set());

  // Free-form (operator-authored) mutators — operate on the full rows array by id.
  const setKey = (id: string, key: string): void => onChange(rows.map((r) => (r.id === id ? { ...r, key } : r)));
  const setCell = (id: string, locale: string, value: string): void =>
    onChange(rows.map((r) => (r.id === id ? { ...r, cells: { ...r.cells, [locale]: value } } : r)));
  const add = (): void => onChange([...rows, newTranslationRow()]);
  const remove = (id: string): void => onChange(rows.filter((r) => r.id !== id));
  const toggleEditKey = (id: string): void =>
    setEditingKeys((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // A reserved key shares the catalog but is addressed BY KEY (not row id): update its stored row, or
  // MATERIALIZE a fresh row on first edit. Clearing every cell leaves an empty row that the save prunes.
  const setReservedCell = (key: string, locale: string, value: string): void => {
    const existing = rows.find((r) => r.key.trim() === key);
    if (existing) {
      onChange(rows.map((r) => (r === existing ? { ...r, cells: { ...r.cells, [locale]: value } } : r)));
    } else {
      onChange([...rows, { ...newTranslationRow(), key, cells: { [locale]: value } }]);
    }
  };

  // Reserved groups surfaced as ghost rows: the feature is active AND there's more than one locale to
  // translate into (a single-locale site renders the English defaults, so no table clutter). When a group
  // is NOT surfaced (feature off), any rows the operator already materialized for its keys simply appear
  // as ordinary free rows — harmless (the render still floors to the English default). Extend the feature
  // switch below when a second ReservedTranslationGroup.feature is added.
  const multiLocale = localeCodes.length > 1;
  const surfacedGroups = RESERVED_TRANSLATION_GROUPS.filter((g) => (g.feature === 'shop' ? shopEnabled : false) && multiLocale);
  const surfacedKeys = new Set(surfacedGroups.flatMap((g) => g.keys.map((k) => k.key)));
  const storedByKey = new Map(rows.map((r) => [r.key.trim(), r] as const));
  // Free rows = everything not owned by a surfaced reserved group (those render in their own section).
  const freeRows = rows.filter((r) => !surfacedKeys.has(r.key.trim()));
  // SCOPE grouping: a dotted key (`home.headline`) groups under its first segment (`home`); a flat key
  // groups under "General". Order is first-seen (stable). When NO key uses a scope, render flat (no
  // headers) so a simple catalog stays simple.
  const freeGroups = (() => {
    const order: string[] = [];
    const byScope = new Map<string, TranslationRow[]>();
    for (const r of freeRows) {
      const k = r.key.trim();
      const scope = k.includes('.') ? k.slice(0, k.indexOf('.')) : '';
      if (!byScope.has(scope)) {
        byScope.set(scope, []);
        order.push(scope);
      }
      byScope.get(scope)!.push(r);
    }
    return order.map((scope) => ({ scope, rows: byScope.get(scope)! }));
  })();
  const hasScopes = freeGroups.some((g) => g.scope !== '');
  const colSpan = localeCodes.length + 2;

  const localeHeaders = localeCodes.map((loc) => (
    <th key={loc} className="px-1 text-left text-xs font-medium text-slate-500">
      <span aria-hidden className="mr-1">
        {localeFlag(loc)}
      </span>
      <span className="font-mono uppercase">{loc}</span>
      {loc === defaultLocale && <span className="ml-1 font-normal text-slate-400">(main)</span>}
    </th>
  ));

  const reservedRow = (k: ReservedTranslation) => {
    const stored = storedByKey.get(k.key);
    return (
      <tr key={`reserved-${k.key}`} className="bg-indigo-50/40">
        <td className="align-top">
          <div className="flex items-center gap-1.5 px-1 py-2" title="Built-in key — cannot be renamed">
            <Lock aria-hidden className="h-3 w-3 shrink-0 text-slate-400" />
            <span className="min-w-0">
              <code className="block truncate font-mono text-xs text-slate-600">{k.key}</code>
              <span className="block truncate text-[11px] text-slate-400">{k.label}</span>
            </span>
          </div>
        </td>
        {localeCodes.map((loc) => (
          <td key={loc} className="align-top">
            <input
              className={glassInput}
              value={cellValue(stored?.cells ?? {}, loc)}
              onChange={(e) => setReservedCell(k.key, loc, e.target.value)}
              placeholder={k.default}
              aria-label={`${k.key} — ${loc}`}
            />
          </td>
        ))}
        <td className="align-top" />
      </tr>
    );
  };

  const freeRow = (row: TranslationRow) => {
    // Blank keys (new rows) are always editable; a non-blank key locks behind the pencil so a careless
    // edit can't orphan its references.
    const locked = row.key.trim() !== '' && !editingKeys.has(row.id);
    return (
      <tr key={row.id}>
        <td className="align-top">
          <div className="flex items-start gap-1">
            <input
              className={`${glassInput} font-mono ${locked ? 'cursor-default bg-slate-50 text-slate-500' : ''}`}
              value={row.key}
              readOnly={locked}
              onChange={(e) => setKey(row.id, e.target.value)}
              placeholder="nav_cta"
              aria-label="Translation key"
            />
            {row.key.trim() !== '' && (
              <button
                type="button"
                aria-label={locked ? 'Edit key' : 'Lock key'}
                aria-pressed={!locked}
                title={locked ? 'Edit key (renaming may break references)' : 'Lock key'}
                onClick={() => toggleEditKey(row.id)}
                className={`mt-1 shrink-0 rounded-lg p-2 transition ${locked ? 'text-slate-400 hover:bg-slate-100 hover:text-slate-600' : 'text-indigo-600 hover:bg-indigo-50'}`}
              >
                {locked ? <Pencil className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
              </button>
            )}
          </div>
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
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-slate-500">
        Site-wide phrases shared across every page and language. Reference one with{' '}
        <code>{'{{sw-translate "key"}}'}</code> in a slot/template, or make any element editable in the live
        preview with <code>data-sw-translate=&quot;key&quot;</code>. Empty cells fall back to the main language.
        {surfacedGroups.length > 0 && ' Built-in rows (locked key) come pre-listed — just fill in the translations.'}
      </p>
      {(surfacedGroups.length > 0 || freeRows.length > 0) && (
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-1 text-sm">
            <thead>
              <tr>
                <th className="px-1 text-left text-xs font-medium text-slate-500">Key</th>
                {localeHeaders}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {surfacedGroups.map((group) => (
                <FragmentRows key={group.id}>
                  <tr>
                    <td colSpan={colSpan} className="px-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      {group.label}
                    </td>
                  </tr>
                  {group.keys.map((k) => reservedRow(k))}
                </FragmentRows>
              ))}
              {hasScopes
                ? freeGroups.map((g) => (
                    <FragmentRows key={`scope-${g.scope || '__general__'}`}>
                      <tr>
                        <td colSpan={colSpan} className="px-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                          {g.scope || 'General'}
                        </td>
                      </tr>
                      {g.rows.map((row) => freeRow(row))}
                    </FragmentRows>
                  ))
                : freeRows.map((row) => freeRow(row))}
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

/** A keyed group of sibling <tr>s (the `<>` shorthand can't take the group key directly). */
function FragmentRows({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
