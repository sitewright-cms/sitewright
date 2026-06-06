import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { ghostButton, glassPanel } from '../../theme';
import { LIBRARY_SECTIONS, type LibraryCategory, type LibraryItem, type LibrarySection } from './catalog';

/** Copy-to-clipboard with a transient "copied" flag keyed by an id (timer cleared on unmount). */
function useCopy(): [string | null, (text: string, id: string) => void] {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const copy = (text: string, id: string) => {
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedId(id);
        timer.current = setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1400);
      })
      .catch(() => setCopiedId(null));
  };
  return [copiedId, copy];
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
 * The project-level Library reference: a LEFT-edge drawer that expands on hover (a thin
 * rail otherwise). Each section title is a button that opens a searchable gallery modal —
 * Icons (lazy-loaded, the whole pack), AOS, Lazy-load, Ripple, and DaisyUI components
 * (each with a live preview). Read-only; it never mutates the project.
 */
export function LibraryPanel() {
  const [expanded, setExpanded] = useState(false);
  const [openCategory, setOpenCategory] = useState<LibraryCategory | null>(null);
  const section = openCategory ? (LIBRARY_SECTIONS.find((s) => s.category === openCategory) ?? null) : null;

  return (
    <>
      <aside
        aria-label="Library"
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
        // Keyboard/touch parity with hover: expand when focus enters, collapse when it
        // leaves the rail entirely (so the section buttons are reachable by Tab).
        onFocus={() => setExpanded(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setExpanded(false);
        }}
        className={`fixed left-0 top-16 bottom-0 z-30 flex flex-col border-r border-white/60 bg-white/85 shadow-2xl backdrop-blur-xl transition-[width] duration-200 ${
          expanded ? 'w-64' : 'w-11'
        }`}
      >
        {/* Always-present focusable toggle — the keyboard/touch entry point. Focusing it
            (Tab) expands the rail; the section buttons below then become tabbable. */}
        <button
          type="button"
          aria-expanded={expanded}
          aria-label="Open library"
          // Open-only (idempotent with hover/focus); the rail collapses on mouseleave/blur.
          // A toggle here would fight the mouseenter that necessarily precedes a click.
          onClick={() => setExpanded(true)}
          className="flex items-center justify-center px-1 py-3 text-xs font-bold uppercase tracking-widest text-slate-500 transition hover:text-slate-800"
        >
          {expanded ? (
            <span className="w-full px-2 text-left">Library</span>
          ) : (
            <span className="rotate-180 [writing-mode:vertical-rl]">Library</span>
          )}
        </button>
        {expanded && (
          <nav className="flex flex-col gap-1.5 overflow-auto p-3 pt-1">
            {LIBRARY_SECTIONS.map((s) => (
              <button
                key={s.category}
                onClick={() => setOpenCategory(s.category)}
                className={`${glassPanel} rounded-xl px-3 py-2.5 text-left transition hover:bg-white`}
              >
                <span className="block text-sm font-semibold text-slate-700">{s.label}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-slate-400">{s.blurb}</span>
              </button>
            ))}
          </nav>
        )}
      </aside>

      {section && <SectionModal section={section} onClose={() => setOpenCategory(null)} />}
    </>
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
          setItems(lazy === 'brand' ? m.BRAND_ITEMS : m.ICON_ITEMS);
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

  // A grid section (icons or brand logos) — capped so the 1865-icon set stays responsive;
  // searching narrows it. Other sections show everything.
  const isGrid = section.category === 'icons' || section.category === 'brand';
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

/** A dense, searchable grid of icons; clicking one copies its `{{icon …}}` snippet. */
function IconGrid({ items }: { items: LibraryItem[] }) {
  const [copiedId, copy] = useCopy();
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(5rem,1fr))] gap-2">
      {items.map((it) => (
        <button
          key={it.id}
          title={`${it.name} — click to copy ${it.example}`}
          aria-label={`Copy ${it.name} icon snippet`}
          onClick={() => copy(it.example, it.id)}
          className="flex flex-col items-center gap-1 rounded-xl border border-slate-200/70 bg-white/60 p-2.5 text-slate-600 transition hover:border-indigo-300 hover:bg-white hover:text-slate-900"
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

/** A list of component/snippet cards: name, description, optional live preview, code + copy. */
function ItemList({ items, preview }: { items: LibraryItem[]; preview: boolean }) {
  const [copiedId, copy] = useCopy();
  return (
    <ul className="flex flex-col gap-4">
      {items.map((it) => (
        <li key={it.id} className={`${glassPanel} rounded-xl p-4`}>
          <div className="mb-2 flex items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-slate-700">{it.name}</h4>
              <p className="mt-0.5 text-xs text-slate-500">{it.description}</p>
            </div>
            <button onClick={() => copy(it.example, it.id)} className={`${ghostButton} shrink-0 px-2.5 py-1 text-xs`}>
              {copiedId === it.id ? 'Copied!' : 'Copy'}
            </button>
          </div>
          {preview && (
            // STATIC catalog markup (our own content), Handlebars neutralized, themed via
            // `.sw-preview`; pointer-events off so preview links/buttons can't navigate.
            <div
              className="sw-preview pointer-events-none mb-2 overflow-hidden rounded-lg border border-slate-200 p-4"
              dangerouslySetInnerHTML={{ __html: previewHtml(it.example) }}
            />
          )}
          <pre className="overflow-auto rounded-lg border border-slate-200 bg-slate-900 p-3 text-[12px] leading-relaxed text-slate-100">
            <code>{it.example}</code>
          </pre>
        </li>
      ))}
    </ul>
  );
}
