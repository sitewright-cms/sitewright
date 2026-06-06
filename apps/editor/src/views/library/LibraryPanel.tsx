import { useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { ghostButton, glassPanel } from '../../theme';
import { LIBRARY_SECTIONS, type LibraryItem, type LibrarySection } from './catalog';

/** Filters a section's items by a lowercase query over name/keywords/description. */
function filterItems(section: LibrarySection, q: string): LibraryItem[] {
  if (!q) return section.items;
  return section.items.filter(
    (it) =>
      it.name.toLowerCase().includes(q) ||
      (it.keywords ?? '').toLowerCase().includes(q) ||
      it.description.toLowerCase().includes(q),
  );
}

/**
 * The permanent project-level Library reference: a docked right-edge panel (always
 * reachable via the edge handle) listing everything an author can use — Icons, AOS,
 * Lazy-load, Ripple, and DaisyUI components — with search. Each item opens a details
 * modal with a copy-paste example. Read-only; it never mutates the project.
 */
export function LibraryPanel() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState<LibraryItem | null>(null);

  const q = query.trim().toLowerCase();
  const sections = useMemo(
    () => LIBRARY_SECTIONS.map((s) => ({ section: s, items: filterItems(s, q) })).filter((s) => s.items.length > 0),
    [q],
  );

  return (
    <>
      {/* Always-visible edge handle (the "permanent" panel affordance). */}
      <button
        aria-label={open ? 'Close library' : 'Open library'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="fixed right-0 top-1/2 z-30 flex -translate-y-1/2 items-center gap-1.5 rounded-l-xl border border-r-0 border-white/60 bg-white/80 px-2 py-3 text-xs font-semibold text-slate-600 shadow-lg backdrop-blur-xl transition hover:bg-white [writing-mode:vertical-rl]"
        style={{ transform: open ? 'translateY(-50%) translateX(20rem)' : 'translateY(-50%)' }}
      >
        Library
      </button>

      {/* The docked drawer. */}
      <aside
        aria-label="Library"
        className={`fixed right-0 top-16 bottom-0 z-30 flex w-80 flex-col border-l border-white/60 bg-white/85 shadow-2xl backdrop-blur-xl transition-transform duration-200 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="shrink-0 border-b border-white/60 p-3">
          <input
            aria-label="Search library"
            className="w-full rounded-lg border border-white/60 bg-white/70 px-3 py-2 text-sm outline-none focus:border-indigo-400"
            placeholder="Search icons, components…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {sections.map(({ section, items }) => (
            <section key={section.category} className="mb-5">
              <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">{section.label}</h3>
              <p className="mb-2 text-[11px] text-slate-400">{section.blurb}</p>
              {section.category === 'icons' ? (
                <div className="grid grid-cols-5 gap-1">
                  {items.map((it) => (
                    <button
                      key={it.id}
                      title={it.name}
                      aria-label={it.name}
                      onClick={() => setDetail(it)}
                      className="flex flex-col items-center gap-0.5 rounded-lg p-1.5 text-slate-600 transition hover:bg-white hover:text-slate-900"
                    >
                      {it.svg && <span aria-hidden className="h-5 w-5" dangerouslySetInnerHTML={{ __html: it.svg }} />}
                    </button>
                  ))}
                </div>
              ) : (
                <ul className="flex flex-col gap-1">
                  {items.map((it) => (
                    <li key={it.id}>
                      <button
                        onClick={() => setDetail(it)}
                        className={`w-full ${glassPanel} px-3 py-2 text-left text-sm transition hover:bg-white/80`}
                      >
                        <span className="font-medium text-slate-700">{it.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          {sections.length === 0 && <p className="text-sm text-slate-400">No matches.</p>}
        </div>
      </aside>

      {detail && <LibraryDetailModal item={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

function LibraryDetailModal({ item, onClose }: { item: LibraryItem; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(item.example);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Modal title={item.name} size="lg" onClose={onClose}>
      <div className="flex flex-col gap-4 p-5">
        <p className="text-sm text-slate-600">{item.description}</p>
        {item.svg && (
          <div className="flex items-center justify-center rounded-xl border border-white/60 bg-white/60 p-6 text-slate-700">
            <span aria-hidden className="h-12 w-12" dangerouslySetInnerHTML={{ __html: item.svg.replace('h-6 w-6', 'h-12 w-12') }} />
          </div>
        )}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Example</span>
            <button onClick={() => void copy()} className={`${ghostButton} px-2.5 py-1 text-xs`}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          {/* The example is rendered as TEXT (escaped by React) — never as HTML. */}
          <pre className="overflow-auto rounded-xl border border-slate-200 bg-slate-900 p-3 text-[12px] leading-relaxed text-slate-100">
            <code>{item.example}</code>
          </pre>
        </div>
        {item.docsUrl && (
          <a href={item.docsUrl} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 hover:underline">
            Documentation ↗
          </a>
        )}
      </div>
    </Modal>
  );
}
