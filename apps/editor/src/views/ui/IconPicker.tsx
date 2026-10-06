import { useEffect, useMemo, useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import {
  BRAND_ICON_NAMES_ALL,
  FLAG_CIRCLE_SUFFIX,
  FLAG_CODES,
  flagIcon,
  PHOSPHOR_NAMES,
  VENDORED_WEIGHTED_NAMES,
  PHOSPHOR_WEIGHTS,
  searchIcons,
  type PhosphorWeight,
} from '@sitewright/blocks';
import { Modal } from './Modal';
import { fieldLabel, ghostButton, glassInput } from '../../theme';
import { FLAG_PREFIX, iconSvg } from '../library/imagemap/icon-svg';
import { Tooltip } from './Tooltip';

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

/** The two cuts a flag comes in — the flags tab's answer to the Phosphor weight switcher. */
type FlagShape = 'rect' | 'circle';
const FLAG_SHAPE_TABS: [FlagShape, string][] = [
  ['rect', 'Rectangular'],
  ['circle', 'Round'],
];

/**
 * How many tiles are ADDED per page — the first screenful, and each step as the grid is scrolled.
 *
 * ★★ This used to be a hard ceiling: every branch below ended in `.slice(0, PAGE)` with nothing
 * anywhere to raise it, so the picker showed the first 120 matches and scrolling simply ran out.
 * That hid 1393 of 1513 Phosphor icons (92%), 155 of 275 brands, and 135 of 255 flags — half the
 * world's flags were unreachable by browsing at all. Worse, it was SILENT: no count, no "load more",
 * nothing to suggest the set continued. Now it is a page size, and `shown` grows.
 */
const PAGE = 120;

/**
 * Per-term cap handed to the scored search.
 *
 * Generous because the grid pages now — the search no longer has to be the thing that keeps the DOM
 * small, and when it was it silently truncated results a user had deliberately narrowed.
 */
const SEARCH_LIMIT = 600;

/**
 * Pick an icon from the platform library. Promoted out of the image-map Studio when dataset fields
 * gained an `icon` type — the picker was already the whole library (Phosphor at every weight, brand
 * logos, country flags), and the alternative for a dataset row was typing the name by hand, where a
 * typo renders nothing at all and looks like a broken row.
 *
 * `label` is caller-supplied and `hideLabel` suppresses it entirely, because an entry-form field
 * already prints its own label above the control.
 */
export function IconField({
  value,
  onChange,
  label = 'Icon',
  hideLabel = false,
  inputId,
}: {
  value: string;
  onChange: (name: string) => void;
  label?: string;
  hideLabel?: boolean;
  inputId?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      {!hideLabel && <span className={fieldLabel}>{label}</span>}
      <button
        type="button"
        id={inputId}
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

/**
 * The icon SWATCH, and the picker behind it — for a control that already has its own input.
 *
 * `IconField` above OWNS its field: it replaces the input with a button that reads the icon's name.
 * That is right where the name is only ever picked. It is wrong where the name is also typed or
 * pasted, or filled in for you — a social profile's icon is auto-detected from the URL you enter, so
 * the text has to stay visible and editable, and what was missing was simply a way to SEE the icon
 * and to browse for one. Hence a swatch that sits beside the input rather than replacing it.
 *
 * An empty or unresolvable name renders no artwork at all, so the button falls back to a dashed
 * outline — "nothing picked" has to look different from "picked something that draws nothing".
 */
export function IconPickButton({
  value,
  onPick,
  ariaLabel,
}: {
  value: string;
  onPick: (name: string) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const art = iconSvg(value);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={ariaLabel}
        title={value || 'Choose an icon'}
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border transition ${
          art
            ? 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'
            : 'border-dashed border-slate-300 dark:border-slate-600'
        } hover:border-indigo-300 hover:bg-white dark:hover:bg-white/10`}
      >
        {art ? (
          <span
            className="block h-5 w-5 [&>svg]:h-full [&>svg]:w-full"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: art }}
          />
        ) : (
          <ImagePlus aria-hidden className="h-4 w-4 text-slate-400 dark:text-slate-500" />
        )}
      </button>
      {open && <IconPicker value={value} onPick={onPick} onClose={() => setOpen(false)} />}
    </>
  );
}

function IconPicker({ value, onPick, onClose }: { value: string; onPick: (name: string) => void; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>(value.startsWith('brand:') ? 'brands' : value.startsWith(FLAG_PREFIX) ? 'flags' : 'icons');
  const [query, setQuery] = useState('');
  const [weight, setWeight] = useState<PhosphorWeight>(currentWeight(value));
  // Shape is to a flag what weight is to a Phosphor glyph — the same artwork, cut differently — so it
  // gets the same control, and re-opening the picker lands on the shape the value already uses.
  const [flagShape, setFlagShape] = useState<FlagShape>(value.endsWith(FLAG_CIRCLE_SUFFIX) ? 'circle' : 'rect');

  const names = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (tab === 'brands') {
      const all = BRAND_ICON_NAMES_ALL.map((slug: string) => `brand:${slug}`);
      return q ? all.filter((n: string) => n.includes(q)) : all;
    }
    if (tab === 'flags') {
      // The ROUND set is a subset — five flags have no circular variant — so filter to the ones that
      // actually exist in the chosen shape rather than offering a tile that renders nothing.
      const suffix = flagShape === 'circle' ? FLAG_CIRCLE_SUFFIX : '';
      // Matched on the COUNTRY NAME as well as the code: nobody looking for the Dutch flag types "nl",
      // and searching "netherlands" against a list of ISO codes returned nothing at all. The code stays
      // searchable because it is what a template author already has in front of them.
      const all = FLAG_CODES.map((code: string) => ({ code, flag: flagIcon(code) }))
        .filter((f) => f.flag && (flagShape === 'rect' || f.flag.circle))
        .filter((f) => !q || f.code.includes(q) || (f.flag?.name ?? '').toLowerCase().includes(q))
        .map((f) => `${FLAG_PREFIX}${f.code}${suffix}`);
      return all;
    }
    // Phosphor: the platform's own scored search when there's a query (it understands synonyms —
    // "car" finds `taxi`), the plain name list when there isn't.
    // Browsing must list the vendored marks alongside Phosphor's, or `linkedin` is renderable but
    // absent from the only surface an author browses.
    const base = q ? [...new Set(searchIcons(q, SEARCH_LIMIT).flatMap((g) => g.matches))] : [...VENDORED_WEIGHTED_NAMES, ...PHOSPHOR_NAMES];
    return base
      .filter((n: string) => !n.startsWith('brand:'))
      // ★★ ALWAYS suffixed, `regular` included. Omitting it for regular looked like a tidy-up — a
      // bare name is the shortest spelling — but a bare name does NOT render regular: `renderIconSvg`
      // falls back to FILL. So the Regular pill produced byte-identical SVG to Fill, and the one
      // weight most authors want was the one weight the picker could not give them. Measured: all
      // six weights render distinctly once the suffix is explicit.
      .map((n) => `${n}:${weight}`);
  }, [tab, query, weight, flagShape]);

  // ---- paging -----------------------------------------------------------------------------------
  //
  // How many of `names` are rendered. Grows a page at a time as the grid is scrolled, because the
  // tiles are not cheap: each one inlines a real SVG, so rendering all 1513 Phosphor glyphs at once
  // is a visibly janky modal open for a set almost nobody scrolls to the end of.
  const [shown, setShown] = useState(PAGE);

  // Reset to the first page whenever the QUESTION changes. Done during render (React's documented
  // "adjust state when a prop changes" pattern) rather than in an effect, so a new search never
  // paints one frame of the previous result's scroll length first.
  const facet = `${tab}\u0000${query}\u0000${weight}\u0000${flagShape}`;
  const [lastFacet, setLastFacet] = useState(facet);
  if (facet !== lastFacet) {
    setLastFacet(facet);
    setShown(PAGE);
  }

  const gridRef = useRef<HTMLDivElement | null>(null);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const hasMore = shown < names.length;

  useEffect(() => {
    const root = gridRef.current;
    const target = moreRef.current;
    if (!root || !target) return;
    // ★ Degrade, never crash. Scroll-to-load is an ENHANCEMENT over the button, so an environment
    // without IntersectionObserver keeps a fully working picker instead of a white screen where the
    // modal should be. (jsdom is exactly such an environment, which is how this was noticed: the
    // component threw on mount and took six unrelated unit tests down with it.)
    if (typeof IntersectionObserver === 'undefined') return;
    // ★★ `root` IS THE GRID, not the viewport. The grid is the `overflow-auto` scroll container, so
    // with the default root (the viewport) the sentinel is clipped by that ancestor and never
    // reports as intersecting — the observer would arm cleanly and then simply never fire. Same
    // family as the panel-scroll trap: a scrolling panel is the thing that has to be listened to.
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setShown((n) => n + PAGE);
      },
      // Start the next page a little before it is reached, so scrolling stays continuous rather than
      // stopping at a button and resuming.
      { root, rootMargin: '300px' },
    );
    io.observe(target);
    return () => io.disconnect();
    // Re-armed on both: a new observer after each page keeps the callback's closure fresh, and the
    // sentinel is a different node once `hasMore` flips.
  }, [shown, hasMore]);

  // The segmented pill: one look for the SET switcher (icons/brands/flags) and the flag SHAPE switcher,
  // so a second row of choices reads as another facet of the same picker, not a new kind of control.
  const pill = (active: boolean, label: string, onClick: () => void, key: string, role?: 'radio') => (
    <button
      key={key}
      type="button"
      role={role}
      aria-checked={role === 'radio' ? active : undefined}
      onClick={onClick}
      className={`waves-effect rounded-lg px-3 py-1 text-xs capitalize ${
        active ? 'bg-white font-bold text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100'
      }`}
    >
      {label}
    </button>
  );
  const tabBtn = (id: Tab, label: string) => pill(tab === id, label, () => setTab(id), id);

  return (
    <Modal title="Choose an icon" onClose={onClose} size="2xl">
      <div className="flex h-[60dvh] flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            {tabBtn('icons', 'Icons')}
            {tabBtn('brands', 'Brands')}
            {tabBtn('flags', 'Flags')}
          </div>
          <input
            className={`${glassInput} max-w-xs`}
            placeholder={
              tab === 'icons' ? 'Search — try “car”, “bed”, “wifi”' : tab === 'flags' ? 'Search a country — “Germany”, “de”' : 'Search'
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search icons"
          />
          {tab === 'icons' && (
            <div role="radiogroup" aria-label="Icon weight" className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
              {PHOSPHOR_WEIGHTS.map((w) => pill(weight === w, w, () => setWeight(w), w, 'radio'))}
            </div>
          )}
          {tab === 'flags' && (
            <div role="radiogroup" aria-label="Flag shape" className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
              {FLAG_SHAPE_TABS.map(([id, label]) => pill(flagShape === id, label, () => setFlagShape(id), id, 'radio'))}
            </div>
          )}
        </div>

        {/* content-start: the grid is a flex CHILD filling the modal, so without it the few rows a
            narrow search returns stretch to the full height and each tile becomes a tall empty box. */}
        <div
          ref={gridRef}
          data-sw-icon-grid=""
          className="grid min-h-0 flex-1 auto-rows-min content-start grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-2 overflow-auto pr-1"
        >
          {names.slice(0, shown).map((name: string) => (
            // `w-full` on BOTH: the tooltip span is the grid ITEM now, so without it the span fills
            // the cell and the tile inside shrinks to its own content.
            <Tooltip key={name} tip={`${tileLabel(name)} — ${name}`} className="w-full">
              <button
                type="button"
                data-sw-icon-tile=""
                onClick={() => {
                  onPick(name);
                  onClose();
                }}
                className={`waves-effect flex h-[4.5rem] w-full flex-col items-center justify-center gap-1 rounded-xl border p-2 transition hover:-translate-y-0.5 hover:border-slate-400 hover:shadow-md ${
                  name === value ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/40' : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                <span className="block h-7 w-7 shrink-0 [&>svg]:h-full [&>svg]:w-full" aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconSvg(name) }} />
                <span className="w-full truncate text-[10px] text-slate-500 dark:text-slate-400">{tileLabel(name)}</span>
              </button>
            </Tooltip>
          ))}
          {names.length === 0 && <p className="col-span-full p-6 text-center text-sm text-slate-500 dark:text-slate-400">Nothing matched “{query}”.</p>}
          {/* ★ The sentinel IS the button. Scrolling near it loads the next page via the observer
              above; clicking it does the same thing — which is what a keyboard user gets, and they
              cannot scroll a container they have not focused. One control, two ways in. */}
          {hasMore && (
            <button
              ref={moreRef}
              type="button"
              onClick={() => setShown((n) => n + PAGE)}
              className={`${ghostButton} col-span-full my-2 justify-self-center`}
            >
              Load more ({names.length - shown} to go)
            </button>
          )}
        </div>
        {/* ★ The set size, always. The picker used to stop at 120 with nothing to say it had — a
            silent truncation reads as "that is all there is", which is how 92% of the icons went
            unnoticed. */}
        <p aria-live="polite" className="text-[11px] text-slate-500 dark:text-slate-400">
          {names.length === 0
            ? 'No matches'
            : hasMore
              ? `Showing ${shown} of ${names.length}`
              : `${names.length} ${names.length === 1 ? 'icon' : 'icons'}`}
        </p>
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
function tileLabel(name: string): string {
  // A flag is labelled by its COUNTRY, not its code: a grid of two-letter codes is unreadable, and the
  // one thing the author knows is the country's name. (The code is still in the tooltip, and still
  // searchable.) The `-circle` strip is scoped to flags on purpose — Phosphor ships `check-circle`,
  // `x-circle`, `plus-circle` …, and at the `regular` weight those arrive with no `:weight` suffix, so
  // a blanket strip would label them "check", "x", "plus": three different icons on one name.
  if (name.startsWith(FLAG_PREFIX)) {
    const spec = name.slice(FLAG_PREFIX.length);
    const code = spec.endsWith(FLAG_CIRCLE_SUFFIX) ? spec.slice(0, -FLAG_CIRCLE_SUFFIX.length) : spec;
    return flagIcon(code)?.name ?? code;
  }
  const withoutPrefix = name.replace(/^brand:/, '');
  const colon = withoutPrefix.lastIndexOf(':');
  return colon > 0 ? withoutPrefix.slice(0, colon) : withoutPrefix;
}
