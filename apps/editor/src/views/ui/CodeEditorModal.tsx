import { useState } from 'react';
import { Modal } from './Modal';
import { CodeEditor, type CodeLanguage } from '../../lib/code-editor';

interface CodeEditorModalProps {
  title: string;
  /** Initial source. */
  value: string;
  /** Persist the edited source. The modal closes once this resolves; if it REJECTS the modal stays
   *  open (so a failed save doesn't discard the in-progress edit). Sync handlers always close. */
  onSave: (value: string) => void | Promise<void>;
  onClose: () => void;
  /** Optional one-line hint shown above the editor (e.g. available bindings). */
  hint?: string;
  /** Syntax mode — `html` (HTML + Handlebars, default) or `css` (e.g. Critical CSS). */
  language?: CodeLanguage;
}

/**
 * A large, full-height code editor in the global Modal — the platform's single surface for editing
 * any HTML/Handlebars source (partials, raw slots, …). The editor is the black/single-accent
 * CodeMirror; Save (header ✓ or ⌘S) commits the draft and closes (staying open if the save rejects).
 */
export function CodeEditorModal({ title, value, onSave, onClose, hint, language = 'html' }: CodeEditorModalProps) {
  // `value` seeds the draft when the modal opens; external changes while it is mounted are
  // intentionally ignored — the user's live edits take precedence until they Save or close.
  const [draft, setDraft] = useState(value);
  return (
    <Modal
      title={title}
      size="full"
      onClose={onClose}
      onSave={() => {
        // Close only once the save resolves; a rejected save keeps the editor open with the draft.
        void (async () => {
          try {
            await onSave(draft);
            onClose();
          } catch {
            /* stay open — the caller surfaces the error and the draft is preserved */
          }
        })();
      }}
      saveLabel="Save changes"
    >
      <div className="flex h-full flex-col bg-[#0a0a0f]">
        {hint && (
          <p className="shrink-0 border-b border-white/10 px-4 py-2 text-xs text-slate-400">{hint}</p>
        )}
        <div className="min-h-0 flex-1">
          <CodeEditor value={draft} onChange={setDraft} ariaLabel={title} language={language} />
        </div>
        {/* Advertise the keyboard contract — Tab indents inside the editor, so Escape is the
            way out (WCAG 2.1.2: a focus-trapping component must surface its exit mechanism). */}
        <p className="shrink-0 border-t border-white/10 px-4 py-1.5 text-[11px] text-slate-500">
          Tab indents · Shift+Tab outdents · Esc closes
        </p>
      </div>
    </Modal>
  );
}
