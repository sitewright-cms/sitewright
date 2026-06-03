import { useState } from 'react';
import { CodeEditorModal } from './CodeEditorModal';

/** Code-brackets glyph for the Edit affordance. */
function CodeIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

interface CodeFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Modal title (defaults to the label). */
  title?: string;
  /** Optional one-line hint shown above the editor. */
  hint?: string;
  placeholder?: string;
}

/**
 * A read-only PREVIEW of a code/HTML value with an **Edit** button that opens the large black code
 * editor in a modal. Replaces inline textareas for the website partials/slots so authoring HTML +
 * Handlebars happens in a real CodeMirror surface, not a cramped field.
 */
export function CodeField({ label, value, onChange, title, hint, placeholder }: CodeFieldProps) {
  const [open, setOpen] = useState(false);
  const trimmed = value.trim();
  const lineCount = trimmed === '' ? 0 : trimmed.split('\n').length;
  const preview = trimmed === '' ? '' : value.split('\n').slice(0, 3).join('\n');

  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      <div className="overflow-hidden rounded-xl border border-white/60 bg-white/50 shadow-sm backdrop-blur-xl">
        <pre className="max-h-24 overflow-hidden px-3 py-2.5 font-mono text-[11px] leading-relaxed text-slate-600">
          {preview || <span className="text-slate-400">{placeholder || 'Empty — click Edit to add code.'}</span>}
        </pre>
        <div className="flex items-center justify-between border-t border-white/50 bg-white/40 px-3 py-1.5">
          <span className="text-[11px] text-slate-400">{lineCount === 0 ? 'empty' : `${lineCount} line${lineCount === 1 ? '' : 's'}`}</span>
          <button
            type="button"
            aria-label={`Edit ${label}`}
            onClick={() => setOpen(true)}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:border-indigo-400 hover:text-slate-900"
          >
            <CodeIcon /> Edit
          </button>
        </div>
      </div>
      {open && (
        <CodeEditorModal
          title={title ?? label}
          value={value}
          hint={hint}
          onSave={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
