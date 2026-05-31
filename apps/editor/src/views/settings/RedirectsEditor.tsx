import { AnimatePresence, motion } from 'motion/react';
import { glassInput, ghostButton } from './glass';
import { newRedirect, type KeyedRedirect } from './model';

const STATUSES = [301, 302, 307, 308] as const;

/** Controlled editor for publish-time redirect rules (from path → to path/URL + status). */
export function RedirectsEditor({ rows, onChange }: { rows: KeyedRedirect[]; onChange: (rows: KeyedRedirect[]) => void }) {
  const set = (id: string, patch: Partial<KeyedRedirect>) => onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  return (
    <div className="flex flex-col gap-2">
      <AnimatePresence initial={false}>
        {rows.map((r, i) => (
          <motion.div
            key={r.id}
            layout
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            className="flex items-center gap-2"
          >
            <input
              aria-label={`Redirect from ${i + 1}`}
              className={glassInput}
              value={r.from}
              placeholder="/old-path"
              onChange={(e) => set(r.id, { from: e.target.value })}
            />
            <span className="text-slate-400">→</span>
            <input
              aria-label={`Redirect to ${i + 1}`}
              className={glassInput}
              value={r.to}
              placeholder="/new-path"
              onChange={(e) => set(r.id, { to: e.target.value })}
            />
            <select
              aria-label={`Redirect status ${i + 1}`}
              className={`${glassInput} w-24`}
              value={r.status}
              onChange={(e) => set(r.id, { status: Number(e.target.value) })}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label={`Remove redirect ${i + 1}`}
              onClick={() => onChange(rows.filter((x) => x.id !== r.id))}
              className="shrink-0 rounded-md px-2 py-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
            >
              ✕
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
      <button type="button" onClick={() => onChange([...rows, newRedirect()])} className={`${ghostButton} self-start`}>
        + Add redirect
      </button>
    </div>
  );
}
