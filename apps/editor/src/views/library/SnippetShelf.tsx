import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { ghostButton } from '../../theme';
import { useToast } from '../ui/Toast';
import { useCopy } from '../ui/useCopy';
import type { LibraryItem } from './catalog';

/**
 * A collapsible shelf of ready-made, copy-paste snippets — mounted inside a builder/studio so its
 * curated directive examples live NEXT TO the interactive composer instead of as a separate Library
 * entry. Each row copies its (static, in-repo) `example` markup. Read-only. Collapsed by default so
 * it never competes with the builder's own controls.
 */
export function SnippetShelf({ title, items, blurb }: { title: string; items: LibraryItem[]; blurb?: string }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const [copiedId, copy] = useCopy(() => toast.show('Copied to clipboard'));
  if (items.length === 0) return null;
  return (
    <section className="rounded-xl border border-slate-200/70 dark:border-slate-700">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="waves-effect flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left"
      >
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {title} <span className="font-normal text-slate-500 dark:text-slate-400">({items.length})</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-slate-200/70 p-3 dark:border-slate-700">
          {blurb && <p className="text-xs text-slate-500 dark:text-slate-400">{blurb}</p>}
          {items.map((it) => (
            <div key={it.id} className="rounded-lg border border-slate-200/70 bg-white/50 p-2.5 dark:border-slate-700 dark:bg-slate-900/40">
              <div className="mb-1 flex items-start justify-between gap-2">
                <span className="min-w-0 text-xs font-semibold text-slate-600 dark:text-slate-300">{it.name}</span>
                <button type="button" onClick={() => copy(it.example, it.id)} className={`${ghostButton} shrink-0 px-2 py-0.5 text-xs`}>
                  {copiedId === it.id ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <pre className="overflow-x-auto rounded bg-slate-900 p-2 text-xs leading-relaxed text-slate-100">
                <code>{it.example}</code>
              </pre>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
