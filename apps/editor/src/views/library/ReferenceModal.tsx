import { useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';
import { useCopy } from '../ui/useCopy';
import { ghostButton, glassPanel } from '../../theme';
import { REFERENCE_GROUPS, type ReferenceEntry } from './reference';

function navBtn(active: boolean): string {
  return `rounded-lg px-3 py-1.5 text-left text-xs font-medium transition ${
    active ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:bg-white hover:text-slate-800'
  }`;
}

/** One reference entry: a prominent syntax line + Copy, a description, optional args + example + note. */
function EntryCard({ entry, copied, onCopy }: { entry: ReferenceEntry; copied: boolean; onCopy: () => void }) {
  return (
    <li className={`${glassPanel} rounded-xl p-4`}>
      <div className="mb-1.5 flex items-start justify-between gap-3">
        <code className="font-mono text-[13px] font-bold text-indigo-700">{entry.syntax}</code>
        {!entry.noCopy && (
          <button onClick={onCopy} className={`${ghostButton} shrink-0 px-2.5 py-1 text-xs`}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        )}
      </div>
      <p className="text-xs leading-relaxed text-slate-600">{entry.description}</p>
      {entry.args && entry.args.length > 0 && (
        <dl className="mt-2 flex flex-col gap-0.5">
          {entry.args.map((a) => (
            <div key={a.name} className="flex gap-2 text-[11px]">
              <dt className="shrink-0 font-mono font-bold text-slate-500">{a.name}</dt>
              <dd className="text-slate-400">{a.desc}</dd>
            </div>
          ))}
        </dl>
      )}
      {entry.example && (
        <pre className="mt-2 overflow-auto rounded-lg border border-slate-200 bg-slate-900 p-3 text-[12px] leading-relaxed text-slate-100">
          <code>{entry.example}</code>
        </pre>
      )}
      {entry.note && <p className="mt-2 text-[11px] italic text-amber-700">{entry.note}</p>}
    </li>
  );
}

/**
 * The Template Reference: a searchable, grouped guide to the code-first authoring surface — the
 * curated Handlebars helpers, the `data-sw-*` editable directives, the binding namespaces, and the
 * loop/system variables. Read-only; each entry has a Copy button. Opened from the Library panel.
 */
export function ReferenceModal({ onClose }: { onClose: () => void }) {
  const [groupId, setGroupId] = useState<string>('all');
  const [query, setQuery] = useState('');
  const toast = useToast();
  const [copiedId, copy] = useCopy(() => toast.show('Copied to clipboard'));
  const q = query.trim().toLowerCase();
  // Switching groups clears the search, so the new group is never shown as an empty "No matches".
  const selectGroup = (id: string) => {
    setGroupId(id);
    setQuery('');
  };

  const groups = useMemo(() => {
    const base = groupId === 'all' ? REFERENCE_GROUPS : REFERENCE_GROUPS.filter((g) => g.id === groupId);
    if (!q) return base;
    return base
      .map((g) => ({
        ...g,
        entries: g.entries.filter(
          (e) =>
            e.name.toLowerCase().includes(q) ||
            e.syntax.toLowerCase().includes(q) ||
            e.description.toLowerCase().includes(q) ||
            (e.keywords ?? '').toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.entries.length > 0);
  }, [groupId, q]);

  const total = groups.reduce((n, g) => n + g.entries.length, 0);

  return (
    <Modal title="Template reference" size="full" onClose={onClose}>
      <div className="flex h-full min-h-0 gap-4 p-5">
        <nav className="hidden w-44 shrink-0 flex-col gap-1 overflow-auto sm:flex">
          <button onClick={() => selectGroup('all')} className={navBtn(groupId === 'all')}>
            All
          </button>
          {REFERENCE_GROUPS.map((g) => (
            <button key={g.id} onClick={() => selectGroup(g.id)} className={navBtn(groupId === g.id)}>
              {g.title}
            </button>
          ))}
        </nav>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          <input
            aria-label="Search the template reference"
            autoFocus
            className="w-full rounded-lg border border-white/60 bg-white/70 px-3 py-2 text-sm sw-brand-focus outline-none"
            placeholder="Search helpers, directives, variables…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="min-h-0 flex-1 overflow-auto pr-1">
            {total === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">No matches.</p>
            ) : (
              groups.map((g) => (
                <section key={g.id} className="mb-6">
                  <h3 className="text-sm font-bold text-slate-700">{g.title}</h3>
                  <p className="mb-2 text-xs text-slate-400">{g.blurb}</p>
                  <ul className="flex flex-col gap-3">
                    {g.entries.map((e) => (
                      <EntryCard key={e.id} entry={e} copied={copiedId === e.id} onCopy={() => copy(e.example ?? e.syntax, e.id)} />
                    ))}
                  </ul>
                </section>
              ))
            )}
          </div>
          <p className="shrink-0 text-[11px] text-slate-400">{total} entries · click Copy to grab a snippet.</p>
        </div>
      </div>
    </Modal>
  );
}
