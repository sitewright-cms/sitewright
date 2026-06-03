import { AnimatePresence, motion } from 'motion/react';
import { glassInput, ghostButton } from '../../theme';
import { newStr, type KeyedStr } from './model';

/** A controlled list of single string values (social URLs, locale tags), keyed on a stable id. */
export function StringListEditor({
  items,
  onChange,
  placeholder = 'value',
  addLabel = '+ Add',
  ariaLabel = 'item',
}: {
  items: KeyedStr[];
  onChange: (items: KeyedStr[]) => void;
  placeholder?: string;
  addLabel?: string;
  ariaLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <AnimatePresence initial={false}>
        {items.map((it, i) => (
          <motion.div
            key={it.id}
            layout
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            className="flex items-center gap-2"
          >
            <input
              aria-label={`${ariaLabel} ${i + 1}`}
              className={glassInput}
              value={it.value}
              placeholder={placeholder}
              onChange={(e) => onChange(items.map((x) => (x.id === it.id ? { ...x, value: e.target.value } : x)))}
            />
            <button
              type="button"
              aria-label={`Remove ${ariaLabel} ${i + 1}`}
              onClick={() => onChange(items.filter((x) => x.id !== it.id))}
              className="shrink-0 rounded-md px-2 py-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
            >
              ✕
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
      <button type="button" onClick={() => onChange([...items, newStr()])} className={`${ghostButton} self-start`}>
        {addLabel}
      </button>
    </div>
  );
}
