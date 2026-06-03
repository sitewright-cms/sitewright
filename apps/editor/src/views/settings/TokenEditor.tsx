import { AnimatePresence, motion } from 'motion/react';
import { glassInput, ghostButton } from '../../theme';
import { newPair, type KeyedPair } from './model';

// A valid CSS color for the swatch preview (hex / rgb(a) / hsl(a) / keyword) — mirrors
// the server's CssColorSchema so server-valid colors (incl. rgb()/hsl()) render, while
// injection/function notation falls back to transparent. (React sets this as a DOM
// style property, so it is inert regardless — this is purely about showing the right color.)
const SAFE_COLOR = /^#[0-9a-fA-F]{3,8}$|^(?:rgb|hsl)a?\([0-9\s%,./-]+\)$|^[a-zA-Z]+$/;

/**
 * A controlled key→value token editor (brand colors, font families). Keyed on a
 * stable row id so removing a middle row animates + re-renders the correct row.
 */
export function TokenEditor({
  rows,
  onChange,
  keyPlaceholder = 'name',
  valuePlaceholder = 'value',
  swatch = false,
  addLabel = '+ Add token',
}: {
  rows: KeyedPair[];
  onChange: (rows: KeyedPair[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  swatch?: boolean;
  addLabel?: string;
}) {
  const setCell = (id: string, patch: Partial<KeyedPair>) => onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

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
            {swatch && (
              <span
                aria-hidden
                className="h-7 w-7 shrink-0 rounded-md border border-white/70 shadow-inner"
                style={{ background: SAFE_COLOR.test(r.value) ? r.value : 'transparent' }}
              />
            )}
            <input
              aria-label={`${keyPlaceholder} ${i + 1}`}
              className={`${glassInput} max-w-[40%]`}
              value={r.key}
              placeholder={keyPlaceholder}
              onChange={(e) => setCell(r.id, { key: e.target.value })}
            />
            <input
              aria-label={`${valuePlaceholder} ${i + 1}`}
              className={glassInput}
              value={r.value}
              placeholder={valuePlaceholder}
              onChange={(e) => setCell(r.id, { value: e.target.value })}
            />
            <button
              type="button"
              aria-label={`Remove ${r.key || keyPlaceholder} ${i + 1}`}
              onClick={() => onChange(rows.filter((x) => x.id !== r.id))}
              className="shrink-0 rounded-md px-2 py-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
            >
              ✕
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
      <button type="button" onClick={() => onChange([...rows, newPair()])} className={`${ghostButton} self-start`}>
        {addLabel}
      </button>
    </div>
  );
}
