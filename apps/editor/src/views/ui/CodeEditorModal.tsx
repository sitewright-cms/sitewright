import { useState } from 'react';
import { Modal } from './Modal';
import { CodeEditor } from '../../lib/code-editor';

interface CodeEditorModalProps {
  title: string;
  /** Initial source. */
  value: string;
  /** Persist the edited source (the modal closes after). */
  onSave: (value: string) => void;
  onClose: () => void;
  /** Optional one-line hint shown above the editor (e.g. available bindings). */
  hint?: string;
}

/**
 * A large, full-height code editor in the global Modal — the platform's single surface for editing
 * any HTML/Handlebars source (partials, raw slots, …). The editor is the black/single-accent
 * CodeMirror; Save (header ✓ or ⌘S) commits the draft and closes.
 */
export function CodeEditorModal({ title, value, onSave, onClose, hint }: CodeEditorModalProps) {
  // `value` seeds the draft when the modal opens; external changes while it is mounted are
  // intentionally ignored — the user's live edits take precedence until they Save or close.
  const [draft, setDraft] = useState(value);
  return (
    <Modal
      title={title}
      size="full"
      onClose={onClose}
      onSave={() => {
        onSave(draft);
        onClose();
      }}
      saveLabel="Save changes"
    >
      <div className="flex h-full flex-col bg-[#0a0a0f]">
        {hint && (
          <p className="shrink-0 border-b border-white/10 px-4 py-2 text-xs text-slate-400">{hint}</p>
        )}
        <div className="min-h-0 flex-1">
          <CodeEditor value={draft} onChange={setDraft} ariaLabel={title} />
        </div>
      </div>
    </Modal>
  );
}
