import { useEffect, useRef, useState, type ComponentType } from 'react';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Heading2,
  Heading3,
  Pilcrow,
  Quote,
  List,
  ListOrdered,
  Code2,
} from 'lucide-react';

/** A toolbar command: an `execCommand` name + optional argument (for `formatBlock`). */
interface RichCommand {
  icon: ComponentType<{ className?: string }>;
  label: string;
  cmd: string;
  arg?: string;
}

// Mirrors the on-page editor's rich toolbar (preview-bridge.ts) — every output tag is within
// {{sw-rich}}'s sanitizer allowlist (marks, h2/h3, blockquote, lists). Links are added via the
// HTML-source toggle (a/href is allowlisted by the sanitizer); separators (null) group the buttons.
const COMMANDS: ReadonlyArray<RichCommand | null> = [
  { icon: Bold, label: 'Bold', cmd: 'bold' },
  { icon: Italic, label: 'Italic', cmd: 'italic' },
  { icon: Underline, label: 'Underline', cmd: 'underline' },
  { icon: Strikethrough, label: 'Strikethrough', cmd: 'strikeThrough' },
  null,
  { icon: Heading2, label: 'Heading 2', cmd: 'formatBlock', arg: 'h2' },
  { icon: Heading3, label: 'Heading 3', cmd: 'formatBlock', arg: 'h3' },
  { icon: Pilcrow, label: 'Paragraph', cmd: 'formatBlock', arg: 'p' },
  { icon: Quote, label: 'Quote', cmd: 'formatBlock', arg: 'blockquote' },
  null,
  { icon: List, label: 'Bulleted list', cmd: 'insertUnorderedList' },
  { icon: ListOrdered, label: 'Numbered list', cmd: 'insertOrderedList' },
];

const btnClass =
  'inline-flex h-7 w-7 items-center justify-center rounded text-slate-500 transition hover:bg-indigo-50 hover:text-indigo-700';

/**
 * A compact WYSIWYG editor for a dataset `richtext` field — a `contentEditable` surface with the
 * platform's rich toolbar (the same commands the on-page `data-sw-html` editor uses) plus a Link
 * button and a toggle to edit the raw HTML source. Emits HTML via `onChange`; the value is sanitized
 * server-side at render by `{{sw-rich}}` (the same boundary as `data-sw-html`), so this surface only
 * has to produce clean markup, not enforce safety.
 */
export function RichTextField({
  value,
  onChange,
  id,
  ariaLabel,
}: {
  value: string;
  onChange: (html: string) => void;
  id?: string;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Latest value, read by the fill effect WITHOUT being a reactive dep (see below).
  const valueRef = useRef(value);
  valueRef.current = value;
  const [source, setSource] = useState(false);

  // Fill the editable on mount and whenever we (re)enter WYSIWYG mode (source → false). We do NOT
  // reactively re-set innerHTML when `value` changes: `value` only ever changes via this editor's own
  // onChange (its keystroke echo), and re-setting innerHTML mid-edit would reset the caret. Reading
  // the latest value through a ref keeps the dependency on `source` alone.
  useEffect(() => {
    const el = ref.current;
    if (el && !source) el.innerHTML = valueRef.current ?? '';
  }, [source]);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    onChange(el.innerHTML === '<br>' ? '' : el.innerHTML); // normalize a freshly-cleared editable
  };

  const run = (cmd: string, arg?: string) => {
    ref.current?.focus();
    try {
      document.execCommand(cmd, false, arg);
    } catch {
      /* execCommand unsupported (e.g. jsdom) — no-op */
    }
    emit();
  };

  const toolbar = (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200/70 bg-white/60 px-1.5 py-1">
      {!source &&
        COMMANDS.map((c, i) =>
          c === null ? (
            <span key={`sep${i}`} aria-hidden className="mx-0.5 h-4 w-px bg-slate-200" />
          ) : (
            <button
              key={c.label}
              type="button"
              aria-label={c.label}
              title={c.label}
              className={btnClass}
              onMouseDown={(e) => e.preventDefault() /* keep the editable's selection */}
              onClick={() => run(c.cmd, c.arg)}
            >
              <c.icon className="h-4 w-4" />
            </button>
          ),
        )}
      <button
        type="button"
        aria-label="Edit HTML source"
        aria-pressed={source}
        title="Edit HTML source"
        className={`${btnClass} ml-auto ${source ? 'bg-indigo-100 text-indigo-700' : ''}`}
        onClick={() => setSource((v) => !v)}
      >
        <Code2 className="h-4 w-4" />
      </button>
    </div>
  );

  return (
    <div className="overflow-hidden rounded-lg border border-white/60 bg-white/70 shadow-sm focus-within:border-[var(--sw-brand-1)]">
      {toolbar}
      {source ? (
        <textarea
          id={id}
          aria-label={ariaLabel ? `${ariaLabel} (HTML source)` : 'HTML source'}
          className="block min-h-28 w-full resize-y bg-transparent px-3 py-2 font-mono text-xs text-slate-800 outline-none"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <div
          ref={ref}
          id={id}
          role="textbox"
          aria-multiline="true"
          aria-label={ariaLabel}
          data-placeholder="Write…"
          contentEditable
          suppressContentEditableWarning
          spellCheck
          className="sw-rich-edit min-h-24 max-w-none px-3 py-2 text-sm text-slate-800 outline-none"
          onInput={emit}
          onBlur={emit}
        />
      )}
    </div>
  );
}
