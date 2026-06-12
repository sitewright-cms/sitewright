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
 */
export function TokenEditor({
  rows,
  onChange,
  keyPlaceholder = 'name',
  valuePlaceholder = 'value',
  swatch = false,
  picker = false,
  addLabel = '+ Add token',
}: {
  rows: KeyedPair[];
  onChange: (rows: KeyedPair[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  swatch?: boolean;
  picker?: boolean;
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
            {picker ? (
              <ColorField value={r.value} onChange={(v) => setCell(r.id, { value: v })} label={`${r.key || keyPlaceholder} ${i + 1}`} />
            ) : (
              swatch && (
                <span
                  aria-hidden
                  className="h-7 w-7 shrink-0 rounded-md border border-white/70 shadow-inner"
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
              className={`${glassInput}${picker ? ' cursor-default text-slate-500' : ''}`}
              value={r.value}
              placeholder={valuePlaceholder}
              readOnly={picker}
              title={picker ? 'Use the color picker to set this color' : undefined}
              onChange={picker ? undefined : (e) => setCell(r.id, { value: e.target.value })}
            />
            <button
              type="button"
              aria-label={`Remove ${r.key || keyPlaceholder} ${i + 1}`}
              onClick={() => onChange(rows.filter((x) => x.id !== r.id))}
              className="shrink-0 rounded-md px-2 py-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
            >
              <X className="h-4 w-4" />
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
