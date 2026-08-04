import { useMemo, useState } from 'react';
import { BRAND_ICON_NAMES, FLAG_CODES, PHOSPHOR_NAMES, PHOSPHOR_WEIGHTS, searchIcons, type PhosphorWeight } from '@sitewright/blocks';
import { Modal } from '../../ui/Modal';
import { fieldLabel, ghostButton, glassInput } from '../../../theme';
import { FLAG_PREFIX, iconSvg } from './icon-svg';

/**
 * Pick the artwork an Icon hotspot draws.
 *
 * The whole platform library is reachable — Phosphor at every weight, brand logos, country flags —
 * because a map's markers ARE its vocabulary: a bed, a car, a wifi symbol, a flag. The old Studio
 * offered a pin and a dot, so anything else meant giving up.
 *
 * Weight applies to Phosphor only; a brand logo and a flag are single-form artwork, so the weight
 * row is hidden for them rather than shown doing nothing.
 */

type Tab = 'icons' | 'brands' | 'flags';

/** How many results a tab shows at once. Enough to browse, few enough to stay responsive. */
const PAGE = 120;

export function IconField({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <span className={fieldLabel}>Icon</span>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${ghostButton} flex w-full items-center gap-2 px-2 py-1.5 text-left`}
        aria-label="Choose the icon"
      >
        <span
          className="block h-6 w-6 shrink-0 [&>svg]:h-full [&>svg]:w-full"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: iconSvg(value) }}
        />
        <span className="min-w-0 flex-1 truncate text-xs">{value || 'Choose an icon'}</span>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">Change</span>
      </button>
      {open && <IconPicker value={value} onPick={onChange} onClose={() => setOpen(false)} />}
    </div>
  );
}

function IconPicker({ value, onPick, onClose }: { value: string; onPick: (name: string) => void; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>(value.startsWith('brand:') ? 'brands' : value.startsWith(FLAG_PREFIX) ? 'flags' : 'icons');
  const [query, setQuery] = useState('');
  const [weight, setWeight] = useState<PhosphorWeight>(currentWeight(value));

  const names = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (tab === 'brands') {
      const all = BRAND_ICON_NAMES.map((slug: string) => `brand:${slug}`);
      return (q ? all.filter((n: string) => n.includes(q)) : all).slice(0, PAGE);
    }
    if (tab === 'flags') {
      const all = FLAG_CODES.map((code: string) => `${FLAG_PREFIX}${code}`);
      return (q ? all.filter((n: string) => n.includes(q)) : all).slice(0, PAGE);
    }
    // Phosphor: the platform's own scored search when there's a query (it understands synonyms —
    // "car" finds `taxi`), the plain name list when there isn't.
    const base = q ? [...new Set(searchIcons(q, PAGE).flatMap((g) => g.matches))] : [...PHOSPHOR_NAMES];
    return base
      .filter((n: string) => !n.startsWith('brand:'))
      .slice(0, PAGE)
      .map((n) => (weight === 'regular' ? n : `${n}:${weight}`));
  }, [tab, query, weight]);

  const tabBtn = (id: Tab, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setTab(id)}
      className={`rounded-lg px-3 py-1 text-xs ${
        tab === id ? 'bg-white font-bold text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100'
      }`}
    >
      {label}
    </button>
  );

  return (
    <Modal title="Choose an icon" onClose={onClose} size="2xl">
      <div className="flex h-[60vh] flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            {tabBtn('icons', 'Icons')}
            {tabBtn('brands', 'Brands')}
            {tabBtn('flags', 'Flags')}
          </div>
          <input
            className={`${glassInput} max-w-xs`}
            placeholder={tab === 'icons' ? 'Search — try “car”, “bed”, “wifi”' : 'Search'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search icons"
          />
          {tab === 'icons' && (
            <select className={`${glassInput} w-32`} value={weight} onChange={(e) => setWeight(e.target.value as PhosphorWeight)} aria-label="Icon weight">
              {PHOSPHOR_WEIGHTS.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-2 overflow-auto pr-1">
          {names.map((name: string) => (
            <button
              key={name}
              type="button"
              title={name}
              onClick={() => {
                onPick(name);
                onClose();
              }}
              className={`flex flex-col items-center gap-1 rounded-xl border p-2 transition hover:-translate-y-0.5 hover:border-slate-400 hover:shadow-md ${
                name === value ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/40' : 'border-slate-200 dark:border-slate-700'
              }`}
            >
              <span className="block h-7 w-7 [&>svg]:h-full [&>svg]:w-full" aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconSvg(name) }} />
              <span className="w-full truncate text-[10px] text-slate-500 dark:text-slate-400">{shortLabel(name)}</span>
            </button>
          ))}
          {names.length === 0 && <p className="col-span-full p-6 text-center text-sm text-slate-500 dark:text-slate-400">Nothing matched “{query}”.</p>}
        </div>
      </div>
    </Modal>
  );
}

/** The weight encoded in a name, so re-opening the picker lands on what the hotspot already uses. */
function currentWeight(name: string): PhosphorWeight {
  const colon = name.lastIndexOf(':');
  const suffix = colon > 0 ? name.slice(colon + 1) : '';
  return (PHOSPHOR_WEIGHTS as readonly string[]).includes(suffix) ? (suffix as PhosphorWeight) : 'fill';
}

/** `brand:github` → `github`, `map-pin:fill` → `map-pin` — the prefix/weight is already shown above. */
function shortLabel(name: string): string {
  const withoutPrefix = name.replace(/^(brand|flag):/, '');
  const colon = withoutPrefix.lastIndexOf(':');
  return colon > 0 ? withoutPrefix.slice(0, colon) : withoutPrefix;
}
