import { useEffect, useRef, useState } from 'react';
import { sanitizeRichHtml } from '@sitewright/blocks';
import { Modal } from '../ui/Modal';
import { ghostButton, glassInput } from '../../theme';

interface RichRegionPanelProps {
  /** The region key (the `data-sw-html="key"` directive). */
  regionKey: string;
  /** Current HTML for the region (the stored override, or the authored default). */
  value: string;
  /** Called on every edit with the new HTML. Stored verbatim in the page draft; the server +
   *  render pass sanitize it to the allowlist, so what the live preview shows is the safe result. */
  onChange: (html: string) => void;
  onClose: () => void;
}

/** Formatting commands run via `document.execCommand` on the contentEditable surface. The editor
 *  app is the TOP (non-sandboxed) window, so execCommand works here. Link editing is added in a
 *  later PR (alongside the in-place preview toolbar); for now, links can be added via HTML source. */
const COMMANDS: ReadonlyArray<{ cmd: string; arg?: string; label: string; title: string }> = [
  { cmd: 'bold', label: 'B', title: 'Bold' },
  { cmd: 'italic', label: 'I', title: 'Italic' },
  { cmd: 'underline', label: 'U', title: 'Underline' },
  { cmd: 'strikeThrough', label: 'S', title: 'Strikethrough' },
  { cmd: 'formatBlock', arg: 'h2', label: 'H2', title: 'Heading 2' },
  { cmd: 'formatBlock', arg: 'h3', label: 'H3', title: 'Heading 3' },
  { cmd: 'formatBlock', arg: 'blockquote', label: '❝', title: 'Quote' },
  { cmd: 'insertUnorderedList', label: '• List', title: 'Bulleted list' },
  { cmd: 'insertOrderedList', label: '1. List', title: 'Numbered list' },
  { cmd: 'formatBlock', arg: 'p', label: '¶', title: 'Paragraph' },
];

/**
 * The side editor for a RICH (`data-sw-html`) region: a WYSIWYG contentEditable surface with a
 * formatting toolbar, plus a toggleable **HTML source view** for power users (the "Custom HTML"
 * mode — still allowlist-sanitized on save/render, never a raw sink). Edits the shared page draft
 * live (two-way synced with `richContent[key]`); the page editor's one Save persists it.
 */
export function RichRegionPanel({ regionKey, value, onChange, onClose }: RichRegionPanelProps) {
  const [sourceView, setSourceView] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  // Latest value, read by the seeding effect WITHOUT being a dependency — so we reseed only on mount
  // and on the source⇄visual switch, never per keystroke (which would reset the caret).
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    // Sanitize before seeding innerHTML — the value may be raw HTML typed in the source view (or
    // pasted from the preview), and this is the editor origin. Same allowlist as save/render.
    if (!sourceView && editorRef.current) editorRef.current.innerHTML = sanitizeRichHtml(valueRef.current);
  }, [sourceView]);

  const emit = (): void => {
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  };
  const exec = (cmd: string, arg?: string): void => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, arg);
    emit();
  };

  return (
    <Modal
      title={`Rich text — ${regionKey}`}
      size="xl"
      onClose={onClose}
      headerExtra={
        <button type="button" className={ghostButton} onClick={() => setSourceView((s) => !s)}>
          {sourceView ? 'Visual editor' : '</> HTML source'}
        </button>
      }
    >
      <div className="flex flex-col gap-2 p-4">
        {!sourceView && (
          <div role="toolbar" aria-label="Formatting" className="flex flex-wrap gap-1">
            {COMMANDS.map((c) => (
              <button
                key={c.label}
                type="button"
                title={c.title}
                aria-label={c.title}
                // preventDefault keeps the editor's selection so the command applies to it
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => exec(c.cmd, c.arg)}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-900 hover:text-white"
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
        {sourceView ? (
          <textarea
            aria-label={`${regionKey} HTML source`}
            className={`min-h-[16rem] font-mono text-xs ${glassInput}`}
            rows={16}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label={`${regionKey} rich text`}
            onInput={emit}
            className="min-h-[16rem] w-full overflow-auto rounded-xl border border-slate-200 bg-white p-3 text-sm leading-relaxed text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        )}
        <p className="text-xs text-slate-400">
          Formatting is sanitized to a safe allowlist on save; scripts and unsupported tags are removed.
        </p>
      </div>
    </Modal>
  );
}
