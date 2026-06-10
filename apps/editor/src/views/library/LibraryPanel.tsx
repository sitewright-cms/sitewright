import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { SidePanel } from '../ui/SidePanel';
import { useToast } from '../ui/Toast';
import { useCopy } from '../ui/useCopy';
import { ghostButton, glassPanel } from '../../theme';
import { LIBRARY_SECTIONS, type LibraryCategory, type LibraryItem, type LibrarySection } from './catalog';
import { ReferenceModal } from './ReferenceModal';
import { GoogleFontGallery } from '../settings/GoogleFontGallery';

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
 * pack), AOS, Lazy-load, Ripple, and DaisyUI components (each with a live preview). Read-only; it
 * never mutates the project. The gallery modals render inside the panel, so they elevate above it.
 */
export function LibraryPanel() {
  const [openCategory, setOpenCategory] = useState<LibraryCategory | null>(null);
  const [refOpen, setRefOpen] = useState(false);
  const section = openCategory ? (LIBRARY_SECTIONS.find((s) => s.category === openCategory) ?? null) : null;

  return (
    <SidePanel side="left" label="System Library" icon={<LibraryIcon />}>
      <nav className="flex flex-col gap-1.5 p-3">
        {/* The template/directive reference — the author's guide to the code-first surface. */}
        <button
          onClick={() => setRefOpen(true)}
          className="waves-effect rounded-xl border border-indigo-200/70 bg-gradient-to-br from-indigo-50 to-sky-50 px-3 py-2.5 text-left transition hover:from-indigo-100 hover:to-sky-100"
        >
          <span className="block text-sm font-bold text-indigo-800">Template reference</span>
          <span className="mt-0.5 block text-[11px] leading-snug text-indigo-500/80">
            Handlebars helpers, data-sw-* directives, bindings & loop variables.
          </span>
        </button>

        {LIBRARY_SECTIONS.map((s) => (
          <button
            key={s.category}
            onClick={() => setOpenCategory(s.category)}
            className={`waves-effect ${glassPanel} rounded-xl px-3 py-2.5 text-left transition hover:bg-white`}
          >
            <span className="block text-sm font-bold text-slate-700">{s.label}</span>
            <span className="mt-0.5 block text-[11px] leading-snug text-slate-400">{s.blurb}</span>
          </button>
        ))}
      </nav>

      {refOpen && <ReferenceModal onClose={() => setRefOpen(false)} />}
      {section?.category === 'fonts' ? (
        <FontsLibraryModal onClose={() => setOpenCategory(null)} />
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
            className="waves-effect rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600 transition hover:border-indigo-300 hover:text-indigo-700"
            title={`Copy "${font.family}"`}
          >
            {copiedId === font.family ? 'Copied!' : 'Copy name'}
          </button>
        )}
      />
    </Modal>
  );
}

/** Max icons rendered at once (the full Lucide set is 1865) — search narrows below this. */
const GRID_CAP = 360;

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
    void import('./catalog-icons')
      .then((m) => {
        if (alive) {
          setItems(lazy === 'brand' ? m.BRAND_ITEMS : lazy === 'flags' ? m.FLAG_ITEMS : m.ICON_ITEMS);
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

  // A grid section (icons, brand logos, or flags) — capped so the large sets stay responsive;
  // searching narrows it. Other sections show everything.
  const isGrid = section.category === 'icons' || section.category === 'brand' || section.category === 'flags';
  const shown = isGrid ? filtered.slice(0, GRID_CAP) : filtered;
  const overflow = filtered.length - shown.length;

  return (
    <Modal title={section.label} size="full" onClose={onClose}>
      <div className="flex h-full flex-col gap-3 p-5">
        <p className="text-sm text-slate-500">{section.blurb}</p>
        <input
          aria-label={`Search ${section.label}`}
          autoFocus
          className="w-full rounded-lg border border-white/60 bg-white/70 px-3 py-2 text-sm outline-none focus:border-indigo-400"
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="min-h-0 flex-1 overflow-auto pr-1">
          {error ? (
            <p className="py-8 text-center text-sm text-rose-500">Couldn’t load the library set. Close and reopen to retry.</p>
          ) : loading ? (
            // DaisyUI skeleton placeholder while the (large) icon set loads.
            <div className="grid grid-cols-[repeat(auto-fill,minmax(5rem,1fr))] gap-2">
              {Array.from({ length: 36 }, (_, i) => (
                <div key={i} className="skeleton h-[4.5rem] w-full rounded-xl" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No matches.</p>
          ) : isGrid ? (
            <IconGrid items={shown} />
          ) : (
            <ItemList items={filtered} preview={section.preview ?? false} />
          )}
        </div>
        <p className="shrink-0 text-[11px] text-slate-400">
          {filtered.length} {isGrid ? 'icons' : 'items'}
          {overflow > 0 ? ` · showing ${shown.length} — search to narrow` : ''} · click to copy the snippet.
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
          className="waves-effect flex flex-col items-center gap-1 rounded-xl border border-slate-200/70 bg-white/60 p-2.5 text-slate-600 transition hover:border-indigo-300 hover:bg-white hover:text-slate-900"
        >
          {it.svg && <span aria-hidden className="h-6 w-6" dangerouslySetInnerHTML={{ __html: it.svg }} />}
          <span className="w-full truncate text-center text-[10px] text-slate-400">
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
    <pre className="overflow-auto rounded-lg border border-slate-200 bg-slate-900 p-3 text-[12px] leading-relaxed text-slate-100">
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
          <h4 className="text-sm font-bold text-slate-700">{item.name}</h4>
          <p className="mt-0.5 text-xs text-slate-500">{item.description}</p>
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
        <ul className="mt-3 flex flex-col gap-3 border-t border-slate-200/70 pt-3">
          {variants.map((v, i) => (
            <li key={v.name}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{v.name}</span>
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
