import { useState } from 'react';
import { CodeEditorModal } from './CodeEditorModal';
import type { CodeLanguage } from '../../lib/code-editor';

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
  /** Editor mode — `html` (HTML + Handlebars, default) or `css` (Critical CSS). */
  language?: CodeLanguage;
}

/**
 * A compact code field: just the TITLE + a fill/line indicator + an **Edit** button that opens the
 * full black CodeMirror editor in a modal. No inline preview — the modal is the single authoring
 * surface (HTML+Handlebars, or CSS when `language="css"`).
 */
export function CodeField({ label, value, onChange, title, hint, placeholder, language = 'html' }: CodeFieldProps) {
  const [open, setOpen] = useState(false);
  const trimmed = value.trim();
  const lineCount = trimmed === '' ? 0 : trimmed.split('\n').length;

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/60 bg-white/50 px-3 py-2.5 shadow-sm backdrop-blur-xl">
      <div className="min-w-0">
        <span className="block truncate text-xs font-medium text-slate-700">{label}</span>
        <span className="text-[11px] text-slate-400">
          {lineCount === 0 ? (placeholder ? `Empty · e.g. ${placeholder}` : 'Empty') : `${lineCount} line${lineCount === 1 ? '' : 's'}`}
        </span>
      </div>
      <button
        type="button"
        aria-label={`Edit ${label}`}
        onClick={() => setOpen(true)}
        className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:border-indigo-400 hover:text-slate-900"
      >
        <CodeIcon /> Edit
      </button>
      {open && (
        <CodeEditorModal
          title={title ?? label}
          value={value}
          hint={hint}
          language={language}
          onSave={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
