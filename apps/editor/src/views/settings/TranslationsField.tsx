import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { TranslationsEditor } from './TranslationsEditor';
import type { TranslationRow } from './model';

interface TranslationsFieldProps {
  rows: TranslationRow[];
  localeCodes: string[];
  defaultLocale: string;
  onChange: (rows: TranslationRow[]) => void;
}

/**
 * The Translations section's compact entry point — mirrors the skeleton-slot {@link CodeField} cards:
 * a summary row (phrase + locale counts) + an **Edit** affordance that opens the full key × locale grid
 * in a large modal (the grid is too wide/tall to sit inline). Edits flow straight through `onChange`
 * into the settings form draft (saved with everything else), so the modal needs no own save/cancel.
 */
export function TranslationsField({ rows, localeCodes, defaultLocale, onChange }: TranslationsFieldProps) {
  const [open, setOpen] = useState(false);
  const phrases = rows.length;
  const summary =
    phrases === 0
      ? 'No phrases yet'
      : `${phrases} phrase${phrases === 1 ? '' : 's'} · ${localeCodes.length} locale${localeCodes.length === 1 ? '' : 's'}`;

  return (
    <>
      <button
        type="button"
        aria-label="Edit translations"
        onClick={() => setOpen(true)}
        className="waves-effect group flex w-full items-center justify-between gap-3 rounded-xl border border-white/60 bg-white/50 px-3 py-2.5 text-left shadow-sm backdrop-blur-xl transition hover:border-indigo-400 hover:bg-white hover:shadow-md"
      >
        <span className="min-w-0">
          <span className="block truncate text-xs font-medium text-slate-700">Message catalog</span>
          <span className="block text-[11px] text-slate-400">{summary}</span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition group-hover:border-indigo-400 group-hover:text-indigo-600">
          <Pencil className="h-4 w-4" /> Edit
        </span>
      </button>
      {open && (
        <Modal title="Translations" size="2xl" onClose={() => setOpen(false)}>
          <div className="p-5">
            <TranslationsEditor rows={rows} localeCodes={localeCodes} defaultLocale={defaultLocale} onChange={onChange} />
          </div>
        </Modal>
      )}
    </>
  );
}
