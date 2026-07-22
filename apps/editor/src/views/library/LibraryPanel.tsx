import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { SidePanel } from '../ui/SidePanel';
import { useToast } from '../ui/Toast';
import { useCopy } from '../ui/useCopy';
import { ghostButton, glassPanel } from '../../theme';
import { LIBRARY_SECTIONS, type LibraryCategory, type LibraryItem, type LibrarySection } from './catalog';
import { ReferenceModal } from './ReferenceModal';
import { SW_COMPONENT_GROUPS } from './sw-components';
import { BackgroundPicker } from './BackgroundPicker';
import { ButtonBuilderModal } from './ButtonBuilderModal';
import { ParallaxBuilder } from './ParallaxBuilder';
import { SvgAnimStudio } from './SvgAnimStudio';
import { GoogleFontGallery } from '../settings/GoogleFontGallery';
import { SearchField } from '../ui/SearchField';
import { useScrollPaging } from '../../lib/useScrollPaging';

/** Library glyph (stacked books) for the side-panel tab. */
function LibraryIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

/**
 * Replaces Handlebars expressions with neutral placeholder text for a static preview.
 * `[^{}]*` (not `[^}]*`) keeps the match linear-time on adversarial `{`-runs (defensive,
 * though `example` is always static in-repo catalog content).
 */
function previewHtml(example: string): string {
  return example.replace(/\{\{[^{}]*\}\}/g, 'Example');
}

/**
 * The project-level Library reference: a LEFT-edge {@link SidePanel} that expands on hover. Each
 * section title is a button that opens a searchable gallery modal — Icons (lazy-loaded, the whole
 * pack), Animation, Lazy-load, Ripple, and DaisyUI components (each with a live preview). Read-only; it
 * never mutates the project. The gallery modals render inside the panel, so they elevate above it.
 */
export function LibraryPanel({ projectId }: { projectId?: string } = {}) {
  const [openCategory, setOpenCategory] = useState<LibraryCategory | null>(null);
  const [refOpen, setRefOpen] = useState(false);
  const [swOpen, setSwOpen] = useState(false);
  const [bgOpen, setBgOpen] = useState(false);
  const [btnOpen, setBtnOpen] = useState(false);
  const [pxOpen, setPxOpen] = useState(false);
  const [svgOpen, setSvgOpen] = useState(false);
  const section = openCategory ? (LIBRARY_SECTIONS.find((s) => s.category === openCategory) ?? null) : null;

  // The first-party SiteWright components guide — a tab-based reference (one tab per component),
  // rendered like the Template reference. Shown immediately before the DaisyUI components entry.
  const swComponentsButton = (
    <button
      key="sw-components"
      onClick={() => setSwOpen(true)}
      className="waves-effect rounded-xl border border-emerald-200/70 dark:border-emerald-500/20 bg-gradient-to-br from-emerald-50 dark:from-emerald-500/10 to-teal-50 dark:to-teal-500/10 px-3 py-2.5 text-left transition hover:from-emerald-100 dark:hover:from-emerald-500/15 hover:to-teal-100 dark:hover:to-teal-500/15"
    >
      <span className="block text-sm font-bold text-emerald-800 dark:text-emerald-400">SiteWright Components</span>
      <span className="mt-0.5 block text-[11px] leading-snug text-emerald-600/80 dark:text-emerald-400">
        First-party interactive components (data-sw-component) — usage & examples.
      </span>
    </button>
  );

  return (
    <SidePanel side="left" label="System Library" icon={<LibraryIcon />}>
      <nav className="flex flex-col gap-1.5 p-3">
        {/* The template/directive reference — the author's guide to the code-first surface. */}
        <button
          onClick={() => setRefOpen(true)}
          className="waves-effect rounded-xl border border-indigo-200/70 dark:border-indigo-500/20 bg-gradient-to-br from-indigo-50 dark:from-indigo-500/10 to-sky-50 dark:to-sky-500/10 px-3 py-2.5 text-left transition hover:from-indigo-100 dark:hover:from-indigo-500/15 hover:to-sky-100 dark:hover:to-sky-500/15"
        >
          <span className="block text-sm font-bold text-indigo-800 dark:text-indigo-400">Template reference</span>
          <span className="mt-0.5 block text-[11px] leading-snug text-indigo-500/80 dark:text-indigo-300">
            Handlebars helpers, data-sw-* directives, bindings & loop variables.
          </span>
        </button>

        {/* The animated-background preset picker — live WebGL previews; copies data-sw-component="shader-bg" markup. */}
        <button
          onClick={() => setBgOpen(true)}
          className="waves-effect rounded-xl border border-fuchsia-200/70 dark:border-fuchsia-500/20 bg-gradient-to-br from-fuchsia-50 dark:from-fuchsia-500/10 to-violet-50 dark:to-violet-500/10 px-3 py-2.5 text-left transition hover:from-fuchsia-100 dark:hover:from-fuchsia-500/15 hover:to-violet-100 dark:hover:to-violet-500/15"
        >
          <span className="block text-sm font-bold text-fuchsia-800 dark:text-fuchsia-400">Animated backgrounds</span>
          <span className="mt-0.5 block text-[11px] leading-snug text-fuchsia-500/80 dark:text-fuchsia-300">
            WebGL background presets, themed by your CI colors — preview & copy the markup.
          </span>
        </button>

        {/* The Button builder + effects lab — compose a button (face/effect/accent/shape), preview it live
            with your CI colors, and copy the <button class="…"> markup. */}
        <button
          onClick={() => setBtnOpen(true)}
          className="waves-effect rounded-xl border border-amber-200/70 dark:border-amber-500/20 bg-gradient-to-br from-amber-50 dark:from-amber-500/10 to-orange-50 dark:to-orange-500/10 px-3 py-2.5 text-left transition hover:from-amber-100 dark:hover:from-amber-500/15 hover:to-orange-100 dark:hover:to-orange-500/15"
        >
          <span className="block text-sm font-bold text-amber-800 dark:text-amber-400">Button builder</span>
          <span className="mt-0.5 block text-[11px] leading-snug text-amber-600/80 dark:text-amber-400">
            Compose a button (effect, accent, shape) + browse the effects lab — preview & copy the markup.
          </span>
        </button>

        {/* The Parallax builder — compose a scroll-linked element (speed/axis + opacity/scale/blur),
            scroll the live preview, and copy the data-sw-parallax* markup. */}
        <button
          onClick={() => setPxOpen(true)}
          className="waves-effect rounded-xl border border-cyan-200/70 dark:border-cyan-500/20 bg-gradient-to-br from-cyan-50 dark:from-cyan-500/10 to-sky-50 dark:to-sky-500/10 px-3 py-2.5 text-left transition hover:from-cyan-100 dark:hover:from-cyan-500/15 hover:to-sky-100 dark:hover:to-sky-500/15"
        >
          <span className="block text-sm font-bold text-cyan-800 dark:text-cyan-400">Parallax builder</span>
          <span className="mt-0.5 block text-[11px] leading-snug text-cyan-600/80 dark:text-cyan-400">
            Scroll-linked depth, fade, scale & blur — compose, scroll the preview & copy the markup.
          </span>
        </button>

        {/* The SVG Animation Studio — import an SVG, animate each element (effect + timing) with a live
            canvas, and export the animated SVG. */}
        <button
          onClick={() => setSvgOpen(true)}
          className="waves-effect rounded-xl border border-emerald-200/70 dark:border-emerald-500/20 bg-gradient-to-br from-emerald-50 dark:from-emerald-500/10 to-teal-50 dark:to-teal-500/10 px-3 py-2.5 text-left transition hover:from-emerald-100 dark:hover:from-emerald-500/15 hover:to-teal-100 dark:hover:to-teal-500/15"
        >
          <span className="block text-sm font-bold text-emerald-800 dark:text-emerald-400">SVG animation studio</span>
          <span className="mt-0.5 block text-[11px] leading-snug text-emerald-600/80 dark:text-emerald-400">
            Import an SVG → animate each element (draw-on / fade / zoom / flip / reveal / morph) → export.
          </span>
        </button>

        {LIBRARY_SECTIONS.map((s) => (
          // The SiteWright Components entry sits immediately before the DaisyUI components section.
          <Fragment key={s.category}>
            {s.category === 'daisyui' && swComponentsButton}
            <button
              onClick={() => setOpenCategory(s.category)}
              className={`waves-effect ${glassPanel} rounded-xl px-3 py-2.5 text-left transition hover:bg-white dark:hover:bg-white/10`}
            >
              <span className="block text-sm font-bold text-slate-700 dark:text-slate-200">{s.label}</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-slate-400 dark:text-slate-500">{s.blurb}</span>
            </button>
          </Fragment>
        ))}
      </nav>

      {refOpen && <ReferenceModal onClose={() => setRefOpen(false)} />}
      {bgOpen && <BackgroundPicker onClose={() => setBgOpen(false)} />}
      {btnOpen && <ButtonBuilderModal onClose={() => setBtnOpen(false)} />}
      {pxOpen && <ParallaxBuilder onClose={() => setPxOpen(false)} />}
      {svgOpen && <SvgAnimStudio onClose={() => setSvgOpen(false)} projectId={projectId} />}
      {swOpen && (
        <ReferenceModal
          title="SiteWright Components"
          allGroups={SW_COMPONENT_GROUPS}
          searchPlaceholder="Search components…"
          onClose={() => setSwOpen(false)}
        />
      )}
      {section?.category === 'fonts' ? (
        <FontsLibraryModal onClose={() => setOpenCategory(null)} />
      ) : section?.category === 'icons' ? (
        <IconGallery section={section} onClose={() => setOpenCategory(null)} />
      ) : (
        section && <SectionModal section={section} onClose={() => setOpenCategory(null)} />
      )}
    </SidePanel>
  );
}

/** The Library's Google-Fonts browser: search + preview; clicking copies the family name. */
function FontsLibraryModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [copiedId, copy] = useCopy(() => toast.show('Copied to clipboard'));
  return (
    <Modal title="Google Fonts" size="full" onClose={onClose}>
      <GoogleFontGallery
        intro="Browse + preview the full Google Fonts catalog. To USE a font, pick it per slot in Settings → Typography (it's downloaded + self-hosted then). Click a family here to copy its name."
        renderAction={(font) => (
          <button
            type="button"
            onClick={() => copy(font.family, font.family)}
            className="waves-effect rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-0.5 text-xs text-slate-600 dark:text-slate-300 transition hover:border-indigo-300 hover:text-indigo-700 dark:hover:text-indigo-400"
            title={`Copy "${font.family}"`}
          >
            {copiedId === font.family ? 'Copied!' : 'Copy name'}
          </button>
        )}
      />
    </Modal>
  );
}

/** A searchable gallery of one section's items (icons grid, or item cards with optional preview). */
function SectionModal({ section, onClose }: { section: LibrarySection; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<LibraryItem[]>(section.items);
  const [loading, setLoading] = useState(!!section.lazy);
  const [error, setError] = useState(false);

  // Lazy-load the (large) icon / brand-icon sets the first time their modal opens.
  useEffect(() => {
    if (!section.lazy) return;
    const lazy = section.lazy;
    let alive = true;
    // Only brand + flags load here now — the (large) Phosphor icon set is API-driven (see IconGallery).
    void import('./catalog-icons')
      .then((m) => {
        if (alive) {
          setItems(lazy === 'brand' ? m.BRAND_ITEMS : m.FLAG_ITEMS);
          setLoading(false);
        }
      })
      .catch(() => {
        if (alive) {
          setError(true);
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [section.lazy]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      q
        ? items.filter(
            (it) =>
              it.name.toLowerCase().includes(q) ||
              (it.keywords ?? '').toLowerCase().includes(q) ||
              it.description.toLowerCase().includes(q),
          )
        : items,
    [items, q],
  );

  // A grid section (icons, brand logos, or flags) — render a page at a time and append more on scroll
  // (the full sets are large); searching narrows it. Other sections show everything.
  const isGrid = section.category === 'icons' || section.category === 'brand' || section.category === 'flags';
  // Only grids page; pass total=0 for other sections so the pager never grows (they show everything).
  const { visible, reset, onScroll, ref: scrollRef } = useScrollPaging(isGrid ? filtered.length : 0);
  const shown = isGrid ? filtered.slice(0, visible) : filtered;
  const overflow = filtered.length - shown.length;

  return (
    <Modal title={section.label} size="full" onClose={onClose}>
      <div className="flex h-full flex-col gap-3 p-5">
        <p className="text-sm text-slate-500 dark:text-slate-400">{section.blurb}</p>
        <SearchField
          ariaLabel={`Search ${section.label}`}
          autoFocus
          placeholder="Search…"
          value={query}
          onChange={(v) => {
            setQuery(v);
            reset();
          }}
        />
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto pr-1" onScroll={onScroll}>
          {error ? (
            <p className="py-8 text-center text-sm text-rose-500 dark:text-rose-300">Couldn’t load the library set. Close and reopen to retry.</p>
          ) : loading ? (
            // DaisyUI skeleton placeholder while the (large) icon set loads.
            <div className="grid grid-cols-[repeat(auto-fill,minmax(5rem,1fr))] gap-2">
              {Array.from({ length: 36 }, (_, i) => (
                <div key={i} className="skeleton h-[4.5rem] w-full rounded-xl" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">No matches.</p>
          ) : isGrid ? (
            <IconGrid items={shown} />
          ) : (
            <ItemList items={filtered} preview={section.preview ?? false} />
          )}
        </div>
        <p className="shrink-0 text-[11px] text-slate-400 dark:text-slate-500">
          {filtered.length} {isGrid ? 'icons' : 'items'}
          {overflow > 0 ? ` · showing ${shown.length} — scroll for more` : ''} · click to copy the snippet.
        </p>
      </div>
    </Modal>
  );
}

/**
 * The Phosphor icon gallery — names + previews come from the API (GET /authoring/icons/names + /render) so
 * the multi-MB icon data never bundles into the editor. A weight-switcher row (thin…duotone) re-previews
 * the grid and updates the copied `{{sw-icon "name[:weight]"}}` snippet. Fill is the default (no suffix).
 */
function IconGallery({ section, onClose }: { section: LibrarySection; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [weight, setWeight] = useState('fill');
  const [names, setNames] = useState<string[]>([]);
  const [weights, setWeights] = useState<string[]>(['fill']);
  const [sample, setSample] = useState<Record<string, string>>({}); // weight → a sample glyph, for the row
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const previewsRef = useRef<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Names + weights + a representative glyph per weight (for the switcher row), once on open.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await fetch('/authoring/icons/names');
        if (!r.ok) throw new Error();
        const d = (await r.json()) as { names: string[]; weights: string[] };
        if (!alive) return;
        setNames(d.names);
        setWeights(d.weights);
        setLoading(false);
        const s: Record<string, string> = {};
        await Promise.all(
          d.weights.map(async (w) => {
            const rr = await fetch(`/authoring/icons/render?weight=${w}&names=star`);
            if (rr.ok) s[w] = ((await rr.json()) as { svgs: Record<string, string> }).svgs.star ?? '';
          }),
        );
        if (alive) setSample(s);
      } catch {
        if (alive) {
          setError(true);
          setLoading(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => (q ? names.filter((n) => n.includes(q) || n.replace(/-/g, ' ').includes(q)) : names), [names, q]);
  const { visible, reset, onScroll, ref: scrollRef } = useScrollPaging(filtered.length);
  const shown = filtered.slice(0, visible);

  // Render the visible page via the API — best-effort. Previews are keyed by `${weight}:${name}` so (a) a
  // LATE response for a weight the user already switched away from lands in a key nobody reads (never
  // corrupts the current weight), and (b) switching weights back reuses cached glyphs (no refetch/clear).
  // The loop keeps fetching 120-name batches until the whole shown page is rendered — so the scroll-pager's
  // auto-fill can't leave a permanent gap past the first 120. Every requested name is marked (svg or '')
  // so an unrenderable name can't spin the loop. `alive` is re-checked after BOTH awaits.
  useEffect(() => {
    let alive = true;
    void (async () => {
      for (;;) {
        const batch = filtered
          .slice(0, visible)
          .filter((n) => previewsRef.current[`${weight}:${n}`] === undefined)
          .slice(0, 120);
        if (!batch.length || !alive) return;
        try {
          const r = await fetch(`/authoring/icons/render?weight=${weight}&names=${encodeURIComponent(batch.join(','))}`);
          if (!r.ok || !alive) return;
          const d = (await r.json()) as { svgs: Record<string, string> };
          if (!alive) return; // the user may have changed weight during r.json()
          const add: Record<string, string> = {};
          for (const n of batch) add[`${weight}:${n}`] = d.svgs[n] ?? ''; // '' marks "attempted, no glyph"
          previewsRef.current = { ...previewsRef.current, ...add };
          setPreviews((p) => ({ ...p, ...add }));
        } catch {
          return; // preview is best-effort
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [visible, q, weight, names]);

  const items: LibraryItem[] = shown.map((n) => ({
    id: `icon-${n}`,
    name: n,
    description: '',
    example: weight === 'fill' ? `{{sw-icon "${n}" "h-5 w-5"}}` : `{{sw-icon "${n}:${weight}" "h-5 w-5"}}`,
    svg: previews[`${weight}:${n}`] || undefined,
  }));
  const overflow = filtered.length - shown.length;

  return (
    <Modal title={`${section.label} — Phosphor`} size="full" onClose={onClose}>
      <div className="flex h-full flex-col gap-3 p-5">
        <p className="text-sm text-slate-500 dark:text-slate-400">{section.blurb}</p>
        {/* Weight switcher — each button shows a sample glyph in that weight; fill is the default. */}
        <div role="radiogroup" aria-label="Icon weight" className="flex flex-wrap gap-2">
          {weights.map((w) => (
            <button
              key={w}
              role="radio"
              aria-checked={weight === w}
              onClick={() => setWeight(w)}
              className={`flex min-w-[7rem] items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium capitalize leading-none transition ${
                weight === w
                  ? 'border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-400/10 dark:text-indigo-200'
                  : 'border-slate-200/70 text-slate-500 hover:border-indigo-300 dark:border-slate-700 dark:text-slate-400'
              }`}
            >
              {sample[w] && (
                <span
                  aria-hidden
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center [&>svg]:h-full [&>svg]:w-full"
                  dangerouslySetInnerHTML={{ __html: sample[w]! }}
                />
              )}
              <span>{w}</span>
            </button>
          ))}
        </div>
        <SearchField
          ariaLabel="Search icons"
          autoFocus
          placeholder="Search icons…"
          value={query}
          onChange={(v) => {
            setQuery(v);
            reset();
          }}
        />
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto pr-1" onScroll={onScroll}>
          {error ? (
            <p className="py-8 text-center text-sm text-rose-500 dark:text-rose-300">Couldn’t load the icon set. Close and reopen to retry.</p>
          ) : loading ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(5rem,1fr))] gap-2">
              {Array.from({ length: 36 }, (_, i) => (
                <div key={i} className="skeleton h-[4.5rem] w-full rounded-xl" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">No matches.</p>
          ) : (
            <IconGrid items={items} />
          )}
        </div>
        <p className="shrink-0 text-[11px] text-slate-400 dark:text-slate-500">
          {filtered.length} icons{overflow > 0 ? ` · showing ${shown.length} — scroll for more` : ''} · {weight} · click to copy the snippet.
        </p>
      </div>
    </Modal>
  );
}

/** A dense, searchable grid of icons; clicking one copies its `{{sw-icon …}}` snippet. */
function IconGrid({ items }: { items: LibraryItem[] }) {
  const toast = useToast();
  const [copiedId, copy] = useCopy(() => toast.show('Copied to clipboard'));
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(5rem,1fr))] gap-2">
      {items.map((it) => (
        <button
          key={it.id}
          title={`${it.name} — click to copy ${it.example}`}
          aria-label={`Copy ${it.name} icon snippet`}
          onClick={() => copy(it.example, it.id)}
          className="waves-effect flex flex-col items-center gap-1 rounded-xl border border-slate-200/70 dark:border-slate-700 bg-white/60 dark:bg-slate-900/60 p-2.5 text-slate-600 dark:text-slate-300 transition hover:border-indigo-300 hover:bg-white dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-slate-100"
        >
          {it.svg && <span aria-hidden className="h-6 w-6" dangerouslySetInnerHTML={{ __html: it.svg }} />}
          <span className="w-full truncate text-center text-[10px] text-slate-400 dark:text-slate-500">
            {copiedId === it.id ? 'Copied!' : it.name}
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * A live, INTERACTIVE preview of STATIC in-repo catalog markup (Handlebars neutralized), themed via
 * `.sw-preview` (whose `contain` keeps fixed-position components inside the card). The guards stop a
 * preview link/form from navigating the editor (click + middle-click + submit).
 */
function Preview({ html }: { html: string }) {
  return (
    <div
      className="sw-preview mb-2 overflow-hidden rounded-lg border border-slate-200 p-4"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a')) e.preventDefault();
      }}
      onAuxClick={(e) => {
        if ((e.target as HTMLElement).closest('a')) e.preventDefault();
      }}
      onSubmit={(e) => e.preventDefault()}
      dangerouslySetInnerHTML={{ __html: previewHtml(html) }}
    />
  );
}

/** Dark code block for a copy-paste snippet. */
function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="overflow-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-900 p-3 text-[12px] leading-relaxed text-slate-100">
      <code>{code}</code>
    </pre>
  );
}

/** One component card: name, description, live preview, code + copy, and a collapsed list of the
 *  component's documented variants behind a "Show all variants" toggle. */
function ItemCard({ item, preview }: { item: LibraryItem; preview: boolean }) {
  const toast = useToast();
  const [copiedId, copy] = useCopy(() => toast.show('Copied to clipboard'));
  const [expanded, setExpanded] = useState(false);
  const variants = item.variants ?? [];
  return (
    <li className={`${glassPanel} rounded-xl p-4`}>
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200">{item.name}</h4>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{item.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {variants.length > 0 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className={`${ghostButton} px-2.5 py-1 text-xs`}
            >
              {expanded ? 'Hide variants' : `Show all variants (${variants.length})`}
            </button>
          )}
          <button onClick={() => copy(item.example, item.id)} className={`${ghostButton} px-2.5 py-1 text-xs`}>
            {copiedId === item.id ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>
      {preview && <Preview html={item.example} />}
      <CodeBlock code={item.example} />
      {expanded && variants.length > 0 && (
        <ul className="mt-3 flex flex-col gap-3 border-t border-slate-200/70 dark:border-slate-700 pt-3">
          {variants.map((v, i) => (
            <li key={v.name}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{v.name}</span>
                <button
                  onClick={() => copy(v.example, `${item.id}:${i}`)}
                  className={`${ghostButton} shrink-0 px-2 py-0.5 text-[11px]`}
                >
                  {copiedId === `${item.id}:${i}` ? 'Copied!' : 'Copy'}
                </button>
              </div>
              {preview && <Preview html={v.example} />}
              <CodeBlock code={v.example} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** A list of component/snippet cards. For the DaisyUI section it LAZY-loads each component's
 *  documented variants (a large set) and attaches them to the items. */
function ItemList({ items, preview }: { items: LibraryItem[]; preview: boolean }) {
  const [variantsById, setVariantsById] = useState<Record<string, LibraryItem['variants']>>({});
  useEffect(() => {
    if (!preview) return; // only the DaisyUI (preview) section ships variants
    let alive = true;
    void import('./catalog-daisy-variants')
      .then((m) => alive && setVariantsById(m.DAISY_VARIANTS))
      .catch(() => {
        /* variants are an enhancement; the cards still work without them */
      });
    return () => {
      alive = false;
    };
  }, [preview]);
  return (
    <ul className="flex flex-col gap-4">
      {items.map((it) => (
        <ItemCard key={it.id} item={variantsById[it.id] ? { ...it, variants: variantsById[it.id] } : it} preview={preview} />
      ))}
    </ul>
  );
}
