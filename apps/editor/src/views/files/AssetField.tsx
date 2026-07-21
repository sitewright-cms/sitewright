import { useState } from 'react';
import { FilePicker } from './FilePicker';
import { ACCEPT, type AcceptFilter } from './FileBrowser';
import { fieldLabel, glassInput, ghostButton } from '../../theme';

/** Heuristic: does this value look like an image URL (for the inline thumbnail)? Never thumbnail a
 *  `javascript:`/`data:` value (display-only safety; `<img src>` can't execute, but don't render it). */
const looksLikeImage = (v: string) =>
  !/^\s*(javascript|data):/i.test(v) &&
  (/\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i.test(v) || /^\/media\/[^?#]+\.(jpg|jpeg|png|webp|avif|gif)/i.test(v));

/**
 * An asset-valued field: a text input holding a URL/path, a thumbnail when it looks like an image, a
 * **Browse** button that opens the {@link FilePicker} (library + URL/import, filtered by `accept`),
 * and Clear. The field still accepts hand-typed values — the picker is an assist, not a constraint.
 */
export function AssetField({
  label,
  value,
  onChange,
  projectId,
  accept = ACCEPT.image,
  placeholder,
  hideLabel = false,
  inputId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  projectId: string;
  accept?: AcceptFilter;
  placeholder?: string;
  /** Suppress the built-in label (when a parent already renders one, e.g. the dataset entry form). */
  hideLabel?: boolean;
  /** Optional id for the input, so an external `<label htmlFor>` can target it. */
  inputId?: string;
}) {
  const [picking, setPicking] = useState(false);
  return (
    <div className="block">
      {!hideLabel && <span className={fieldLabel}>{label}</span>}
      <div className="flex items-center gap-2">
        {value && looksLikeImage(value) && (
          <img src={value} alt="" className="h-9 w-9 shrink-0 rounded border border-slate-200 dark:border-slate-700 object-cover" />
        )}
        <input
          id={inputId}
          // When a parent targets this input with `<label htmlFor={inputId}>`, that IS the accessible
          // name — a duplicate aria-label would override it. Otherwise (the standalone span-labelled
          // case) the input needs its own aria-label.
          aria-label={inputId ? undefined : label}
          className={glassInput}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          aria-label={`Browse for ${label}`}
          className={`${ghostButton} shrink-0 whitespace-nowrap px-2.5 py-1 text-xs`}
          onClick={() => setPicking(true)}
        >
          Browse
        </button>
        {value && (
          <button
            type="button"
            aria-label={`Clear ${label}`}
            className="shrink-0 px-1 text-xs text-slate-400 dark:text-slate-500 transition hover:text-rose-600 dark:hover:text-rose-400"
            onClick={() => onChange('')}
          >
            Clear
          </button>
        )}
      </div>
      {picking && (
        <FilePicker
          projectId={projectId}
          accept={accept}
          title={`Choose ${label.toLowerCase()}`}
          onPick={onChange}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
