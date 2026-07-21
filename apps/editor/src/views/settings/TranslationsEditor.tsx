import { useState } from 'react';
import { Plus, Trash2, Pencil, Lock, ChevronRight } from 'lucide-react';
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
  /** Whether themes are enabled — gates the reserved theme (theme_toggle) ghost row. */
  themesEnabled?: boolean;
  /** Whether the consent manager is enabled — gates the reserved consent (consent_*) ghost rows. */
  consentEnabled?: boolean;
  /**
   * EXTRA ghost-row groups derived at runtime (not from the static registry) — e.g. the `shop.<key>`
   * channel/field labels built from the shop config. Surfaced as-is (the caller decides when to pass them);
   * unlike reserved groups they're shown regardless of locale count, since these keys have no platform default.
   */
  extraGhostGroups?: Array<{ id: string; label: string; keys: readonly ReservedTranslation[] }>;
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
export function TranslationsEditor({ rows, localeCodes, defaultLocale, shopEnabled = false, themesEnabled = false, consentEnabled = false, extraGhostGroups = [], onChange }: TranslationsEditorProps) {
  // Row ids whose KEY is currently unlocked for editing (blank keys are always editable — new rows).
  const [editingKeys, setEditingKeys] = useState<ReadonlySet<string>>(() => new Set());
  // Scoped/reserved groups are COLLAPSED by default; `expanded` holds the group ids the user opened.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  // The last row the operator touched — its group stays open even while collapsed, so a row you're
  // editing (or a freshly added one whose key you're typing into a scope) never vanishes mid-edit.
  const [lastTouched, setLastTouched] = useState<string | null>(null);

  // Free-form (operator-authored) mutators — operate on the full rows array by id.
  const setKey = (id: string, key: string): void => {
    setLastTouched(id);
    onChange(rows.map((r) => (r.id === id ? { ...r, key } : r)));
  };
  const setCell = (id: string, locale: string, value: string): void => {
    setLastTouched(id);
    onChange(rows.map((r) => (r.id === id ? { ...r, cells: { ...r.cells, [locale]: value } } : r)));
  };
  const add = (): void => {
    const row = newTranslationRow();
    setLastTouched(row.id);
    onChange([...rows, row]);
  };
  const remove = (id: string): void => onChange(rows.filter((r) => r.id !== id));
  const toggleEditKey = (id: string): void =>
    setEditingKeys((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleGroup = (id: string): void =>
    setExpanded((prev) => {
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
      setLastTouched(existing.id);
      onChange(rows.map((r) => (r === existing ? { ...r, cells: { ...r.cells, [locale]: value } } : r)));
    } else {
      const row = { ...newTranslationRow(), key, cells: { [locale]: value } };
      setLastTouched(row.id);
      onChange([...rows, row]);
    }
  };

  // Reserved groups surfaced as ghost rows: the feature is active AND there's more than one locale to
  // translate into (a single-locale site renders the English defaults, so no table clutter). When a group
  // is NOT surfaced (feature off), any rows the operator already materialized for its keys simply appear
  // as ordinary free rows — harmless (the render still floors to the English default). Extend the feature
  // switch below when a second ReservedTranslationGroup.feature is added.
  const multiLocale = localeCodes.length > 1;
  // Reserved (registry) groups need >1 locale (single-locale uses the built-in EN defaults). Extra ghost
  // groups (e.g. the shop `shop.<key>` channel/field labels) are surfaced as passed — they have no platform
  // default, so they must be fillable even single-locale. Empty groups (no keys) are dropped.
  // Feature-gated groups (shop) surface only when that feature is on AND there's a 2nd locale to fill.
  // A SYSTEM group (no `feature`) carries a11y strings that exist on EVERY site, so it also surfaces on
  // a single-locale NON-English site (so e.g. a German-only site can localize the carousel/close labels
  // — a single English site already matches the built-in defaults, so it stays clutter-free).
  const reservedSurfaced = RESERVED_TRANSLATION_GROUPS.filter((g) =>
    g.feature === 'shop'
      ? shopEnabled && multiLocale
      : g.feature === 'themes'
        ? // the toggle's aria-label is an a11y string — also surface it on a single-locale NON-English
          // site (so e.g. a German-only site can localize it without adding a second locale)
          themesEnabled && (multiLocale || defaultLocale !== 'en')
        : g.feature === 'consent'
          ? // consent copy is shown to EVERY visitor — surface it for a single-locale non-English site too
            consentEnabled && (multiLocale || defaultLocale !== 'en')
          : multiLocale || defaultLocale !== 'en',
  );
  const surfacedGroups: Array<{ id: string; label: string; keys: readonly ReservedTranslation[] }> = [...reservedSurfaced, ...extraGhostGroups].filter(
    (g) => g.keys.length > 0,
  );
  const surfacedKeys = new Set(surfacedGroups.flatMap((g) => g.keys.map((k) => k.key)));
  const storedByKey = new Map(rows.map((r) => [r.key.trim(), r] as const));
  // Free rows = everything not owned by a surfaced reserved group (those render in their own section).
  // Row ORDER (alphabetical) is set once at load in model.ts `translationsToRows`, then held in state —
  // NOT re-sorted here, so a row being typed (or a freshly added blank row) never jumps position.
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
    <th key={loc} className="px-1 text-left text-xs font-medium text-slate-500 dark:text-slate-400">
      <span aria-hidden className="mr-1">
        {localeFlag(loc)}
      </span>
      <span className="font-mono uppercase">{loc}</span>
      {loc === defaultLocale && <span className="ml-1 font-normal text-slate-400 dark:text-slate-500">(main)</span>}
    </th>
  ));

  const reservedRow = (k: ReservedTranslation) => {
    const stored = storedByKey.get(k.key);
    return (
      <tr key={`reserved-${k.key}`} className="bg-indigo-50/40 dark:bg-indigo-500/10">
        <td className="align-top">
          <div className="flex items-center gap-1.5 px-1 py-2" title="Built-in key — cannot be renamed">
            <Lock aria-hidden className="h-3 w-3 shrink-0 text-slate-400 dark:text-slate-500" />
            <span className="min-w-0">
              <code className="block truncate font-mono text-xs text-slate-600 dark:text-slate-300">{k.key}</code>
              <span className="block truncate text-[11px] text-slate-400 dark:text-slate-500">{k.label}</span>
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
              className={`${glassInput} font-mono ${locked ? 'cursor-default bg-slate-50 dark:bg-white/5 text-slate-500 dark:text-slate-400' : ''}`}
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
                className={`mt-1 shrink-0 rounded-lg p-2 transition ${locked ? 'text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-600 dark:hover:text-slate-300' : 'text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10'}`}
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
            className="rounded-lg p-2 text-slate-400 dark:text-slate-500 transition hover:bg-rose-50 dark:hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </td>
      </tr>
    );
  };

  // A group section header. `collapsible` groups get a chevron toggle (collapsed by default); the
  // non-collapsible "General" header is a plain label (it hosts new rows, so it stays open).
  const groupHeader = (id: string, label: string, count: number, open: boolean, collapsible: boolean) => (
    <tr key={`head-${id}`}>
      <td colSpan={colSpan} className="px-1 pt-2">
        {collapsible ? (
          <button
            type="button"
            onClick={() => toggleGroup(id)}
            aria-expanded={open}
            className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 transition hover:text-slate-600 dark:hover:text-slate-300"
          >
            <ChevronRight aria-hidden className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
            {label} <span className="font-normal normal-case text-slate-400 dark:text-slate-500">({count})</span>
          </button>
        ) : (
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</span>
        )}
      </td>
    </tr>
  );

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-slate-500 dark:text-slate-400">
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
                <th className="px-1 text-left text-xs font-medium text-slate-500 dark:text-slate-400">Key</th>
                {localeHeaders}
                <th className="w-8" />
              </tr>
            </thead>
            {/* Flat keyed children (no per-group wrapper) — a header `<tr>` and a row `<tr>` each carry
                their own stable key, so a row never REMOUNTS when its scope changes mid-edit (which would
                drop input focus); only its position shifts. */}
            <tbody>
              {surfacedGroups.flatMap((group) => {
                const id = `r:${group.id}`;
                const rowIds = group.keys.map((k) => storedByKey.get(k.key)?.id).filter(Boolean) as string[];
                const open = expanded.has(id) || (!!lastTouched && rowIds.includes(lastTouched));
                return [groupHeader(id, group.label, group.keys.length, open, true), ...(open ? group.keys.map((k) => reservedRow(k)) : [])];
              })}
              {freeGroups.flatMap((g) => {
                // "General" (flat keys) is always open — it hosts new rows; only real scopes collapse.
                if (g.scope === '') {
                  return [...(hasScopes ? [groupHeader('s:__general__', 'General', g.rows.length, true, false)] : []), ...g.rows.map((row) => freeRow(row))];
                }
                const id = `s:${g.scope}`;
                const open = expanded.has(id) || (!!lastTouched && g.rows.some((r) => r.id === lastTouched));
                return [groupHeader(id, g.scope, g.rows.length, open, true), ...(open ? g.rows.map((row) => freeRow(row)) : [])];
              })}
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
