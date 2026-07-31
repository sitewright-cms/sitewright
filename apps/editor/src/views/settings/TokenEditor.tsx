import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { glassInput, ghostButton } from '../../theme';
import { ColorField } from './ColorPicker';
import { SAFE_COLOR } from './color';
import { newPair, type KeyedPair } from './model';

/**
 * A controlled key→value token editor (brand colors, font families). Keyed on a
 * stable row id so removing a middle row animates + re-renders the correct row.
 * With `picker`, the swatch becomes a full color-picker trigger (implies `swatch`).
 *
 * `validateValue` marks a row that the SERVER would reject, inline and as you type — otherwise the
 * only feedback is a Zod error on save, naming a field the author can no longer see.
 */
export function TokenEditor({
  rows,
  onChange,
  keyPlaceholder = 'name',
  valuePlaceholder = 'value',
  swatch = false,
  picker = false,
  addLabel = '+ Add token',
  validateValue,
}: {
  rows: KeyedPair[];
  onChange: (rows: KeyedPair[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  swatch?: boolean;
  picker?: boolean;
  addLabel?: string;
  /** Returns an error message for a non-empty value the schema would refuse, else null. */
  validateValue?: (value: string) => string | null;
}) {
  const setCell = (id: string, patch: Partial<KeyedPair>) => onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  // A blank value is "unset" (pairsToRecord drops it), never an error.
  const errorFor = (v: string): string | null => (validateValue && v.trim() ? validateValue(v) : null);

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
            className="flex flex-col gap-1"
          >
            {/* The row keeps its own nowrap flex context: the inputs are `w-full`, so allowing the
                OUTER element to wrap would let them claim a line each in the colour/font editors. */}
            <div className="flex items-center gap-2">
            {picker ? (
              <ColorField value={r.value} onChange={(v) => setCell(r.id, { value: v })} label={`${r.key || keyPlaceholder} ${i + 1}`} />
            ) : (
              swatch && (
                <span
                  aria-hidden
                  className="h-7 w-7 shrink-0 rounded-md border border-white/70 dark:border-white/10 shadow-inner"
                  style={{ background: SAFE_COLOR.test(r.value) ? r.value : 'transparent' }}
                />
              )
            )}
            <input
              aria-label={`${keyPlaceholder} ${i + 1}`}
              className={`${glassInput} max-w-[40%]`}
              value={r.key}
              placeholder={keyPlaceholder}
              onChange={(e) => setCell(r.id, { key: e.target.value })}
            />
            {/* With `picker`, the value is set ONLY through the color picker (the swatch above) —
                the field is read-only so a color can't be typed in, just shown. */}
            <input
              aria-label={`${valuePlaceholder} ${i + 1}`}
              // Same invalid treatment as `Field` in ui.tsx: `!border-red-400` BEATS glassInput's own
              // `border-white/60` (equal specificity, so a plain `border-red-400` loses on sheet order
              // and the marker never shows), and `sw-invalid-focus` reddens the focus ring too — without
              // it `sw-brand-focus` repaints the border brand-indigo exactly while you are typing.
              className={`${glassInput}${picker ? ' cursor-default text-slate-500 dark:text-slate-400' : ''}${
                errorFor(r.value) ? ' !border-red-400 sw-invalid-focus' : ''
              }`}
              value={r.value}
              placeholder={valuePlaceholder}
              readOnly={picker}
              aria-invalid={errorFor(r.value) ? true : undefined}
              aria-describedby={errorFor(r.value) ? `${r.id}-error` : undefined}
              title={picker ? 'Use the color picker to set this color' : undefined}
              onChange={picker ? undefined : (e) => setCell(r.id, { value: e.target.value })}
            />
            <button
              type="button"
              aria-label={`Remove ${r.key || keyPlaceholder} ${i + 1}`}
              onClick={() => onChange(rows.filter((x) => x.id !== r.id))}
              className="shrink-0 rounded-md px-2 py-1 text-slate-400 dark:text-slate-500 transition hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
            >
              <X className="h-4 w-4" />
            </button>
            </div>
            {errorFor(r.value) && (
              <p id={`${r.id}-error`} role="alert" className="pl-1 text-[11px] font-medium text-red-500 dark:text-red-400">
                {errorFor(r.value)}
              </p>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
      <button type="button" onClick={() => onChange([...rows, newPair()])} className={`${ghostButton} self-start`}>
        {addLabel}
      </button>
    </div>
  );
}
