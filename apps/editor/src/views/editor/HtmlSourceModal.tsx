import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { useDialogs } from '../ui/Dialogs';
import { CodeEditor } from '../../lib/code-editor';

interface HtmlSourceModalProps {
  /** The `data-sw-html` directive key whose rich content this edits (shown in the title). */
  swKey: string;
  /** Current raw HTML of the region. */
  value: string;
  onSave: (html: string) => void;
  onClose: () => void;
}

/**
 * "View/edit HTML source" for a rich-text (`data-sw-html`) region — the companion to the in-preview
 * WYSIWYG toolbar (opened by its `</>` button). Edits the RAW HTML in a CodeMirror (HTML) editor;
 * the value is stored as-is and sanitized at RENDER (`sanitizeRichHtml` on every /preview + publish),
 * so disallowed tags/attributes (scripts, event handlers, …) never reach the output. Stacks over the
 * page editor; one Save writes the leaf into the page draft (the preview then reloads to reflect it).
 */
export function HtmlSourceModal({ swKey, value, onSave, onClose }: HtmlSourceModalProps) {
  const { confirm, dialog } = useDialogs();
  const [html, setHtml] = useState(value);
  const dirty = html !== value;
  return (
    <Modal
      title={`Edit HTML — ${swKey}`}
      size="screen"
      onClose={onClose}
      onSave={() => onSave(html)}
      saveDisabled={!dirty}
      // Esc / backdrop / × on a dirty editor confirms first, so in-progress HTML isn't lost silently.
      onBeforeClose={dirty ? () => confirm({ title: 'Discard changes', message: 'Discard unsaved HTML edits?', confirmLabel: 'Discard' }) : undefined}
    >
      <div className="flex h-full flex-col gap-2 p-3">
        <p className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
          Raw HTML for this rich-text region. Disallowed tags and attributes (scripts, event handlers,
          inline styles other than text-align, …) are stripped when the page renders.
        </p>
        <div className="h-[60vh] min-h-0 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
          <CodeEditor value={html} onChange={setHtml} ariaLabel="HTML source" language="html" />
        </div>
      </div>
      {dialog /* the discard-confirm dialog (stacks above this modal) */}
    </Modal>
  );
}
