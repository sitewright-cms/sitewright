import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { CodeEditor, type CodeLanguage } from '../../lib/code-editor';

interface CodeEditorModalProps {
  title: string;
  /** Initial source. */
  value: string;
  /** Persist the edited source (and, when {@link nameEdit} is set, the edited name). The modal STAYS
   *  OPEN either way — a rejected save keeps the draft, and a successful one leaves you where you
   *  were working.
   *
   *  ★ IT MUST ACTUALLY PERSIST, and must REJECT if it could not. The editor reports "Saved" and marks
   *  the draft clean purely on this resolving; a handler that stages into a form needing a separate
   *  submit, or that swallows its own error, turns that into a lie an author acts on. */
  onSave: (value: string, name?: string) => void | Promise<void>;
  onClose: () => void;
  /** Optional one-line hint shown above the editor (e.g. available bindings). */
  hint?: string;
  /** Syntax mode — `html` (HTML + Handlebars, default) or `css` (e.g. Critical CSS). */
  language?: CodeLanguage;
  /**
   * When set, a NAME field is shown above the editor (the modal owns the draft) and its value is
   * passed to onSave. `validate` returns an error string to block saving (or null when acceptable);
   * `onChange` fires as the name is edited so the parent can reflect it live (e.g. the dialog title).
   * Used by templates (free-text name, id kept) and snippets (validated rename).
   */
  nameEdit?: {
    value: string;
    label?: string;
    validate?: (name: string) => string | null;
    onChange?: (name: string) => void;
  };
  /**
   * When set, a "fork existing …" `<select>` is shown above the editor. Picking an option APPENDS the
   * snippet returned by `snippetFor` to the draft (a starting point to edit). Used by the effect
   * custom-code editors to fork a built-in nav/button/preloader effect.
   */
  fork?: {
    label?: string;
    options: { value: string; label: string }[];
    snippetFor: (value: string) => string;
  };
}

/**
 * A large, full-height code editor in the global Modal — the platform's single surface for editing
 * any HTML/Handlebars source (partials, raw slots, critical CSS, …). The editor is the
 * black/single-accent CodeMirror; Save (header ✓ or ⌘S) commits the draft.
 *
 * ★ SAVING DOES NOT CLOSE IT. Editing a slot or a stylesheet is iterative — save, look at the result,
 * keep going — and closing on every save turned that loop into a reopen each time, on the surfaces
 * where the loop is the whole activity. Two things replace closing as the feedback: the Save control
 * disables the moment the draft matches what is stored, and the header says "Saved" for a beat.
 *
 * ★ AND CLOSING NOW HAS TO ASK. While save-then-close was the only exit, unsaved work could not be
 * lost; leaving the modal open makes an Escape or a backdrop click a way to discard edits that were
 * never committed. `onBeforeClose` confirms first — the same guard the slot editor already carries.
 */
export function CodeEditorModal({ title, value, onSave, onClose, hint, language = 'html', nameEdit, fork }: CodeEditorModalProps) {
  // `value` seeds the draft when the modal opens; external changes while it is mounted are
  // intentionally ignored — the user's live edits take precedence until they Save or close.
  const [draft, setDraft] = useState(value);
  const [draftName, setDraftName] = useState(nameEdit?.value ?? '');
  // What is actually stored, as far as this modal knows — the baseline `dirty` is measured against,
  // moved forward only by a save that RESOLVED. A rejected save must leave the editor still dirty.
  const [saved, setSaved] = useState({ value, name: nameEdit?.value ?? '' });
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const nameError = nameEdit?.validate ? nameEdit.validate(draftName) : null;
  const dirty = draft !== saved.value || (nameEdit ? draftName !== saved.name : false);

  // Clear the "Saved" flash on a timer, and on unmount so a late tick never touches a dead component.
  const flash = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(flash.current), []);

  return (
    <Modal
      title={title}
      size="screen"
      onClose={onClose}
      // Leaving with uncommitted edits is now possible, so it has to be deliberate.
      onBeforeClose={() => !dirty || window.confirm('Discard unsaved changes?')}
      saving={saving}
      saveDisabled={!!nameError || !dirty}
      titleExtra={
        justSaved ? (
          // "Saved" is now the honest word: every caller PERSISTS on save rather than staging into a
          // form that needs its own submit. It only stays honest because a caller whose write failed
          // REJECTS — the draft then stays dirty and this never shows. See CodeEditorModalProps.onSave.
          <span className="text-xs font-medium text-emerald-500 dark:text-emerald-400">Saved</span>
        ) : dirty ? (
          <span className="text-xs text-slate-500 dark:text-slate-400">Unsaved changes</span>
        ) : undefined
      }
      onSave={() => {
        void (async () => {
          setSaving(true);
          try {
            // Only pass the name when name-editing is active, so callers that wired `onSave` as a
            // plain `(value) => …` (e.g. CodeField) keep their single-argument contract.
            await (nameEdit ? onSave(draft, draftName) : onSave(draft));
            setSaved({ value: draft, name: draftName });
            setJustSaved(true);
            clearTimeout(flash.current);
            flash.current = setTimeout(() => setJustSaved(false), 2000);
          } catch {
            /* stay open and still DIRTY — the caller surfaces the error, the draft is preserved */
          } finally {
            setSaving(false);
          }
        })();
      }}
      saveLabel="Save changes"
    >
      <div className="flex h-full flex-col bg-[#0a0a0f]">
        {nameEdit && (
          <div className="shrink-0 border-b border-white/10 px-4 py-2">
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <span className="shrink-0">{nameEdit.label ?? 'Name'}</span>
              <input
                value={draftName}
                onChange={(e) => {
                  setDraftName(e.target.value);
                  nameEdit.onChange?.(e.target.value);
                }}
                aria-label={nameEdit.label ?? 'Name'}
                spellCheck={false}
                autoComplete="off"
                className="min-w-0 flex-1 rounded-md border border-white/15 bg-white/5 px-2 py-1 font-mono text-sm text-slate-100 sw-brand-focus outline-none transition"
              />
            </label>
            {nameError && <p className="mt-1 text-[11px] text-rose-400">{nameError}</p>}
          </div>
        )}
        {fork && fork.options.length > 0 && (
          <div className="shrink-0 border-b border-white/10 px-4 py-2">
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <span className="shrink-0">{fork.label ?? 'Insert / fork existing effect'}</span>
              <select
                value=""
                aria-label={fork.label ?? 'Insert / fork existing effect'}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  const snippet = fork.snippetFor(v);
                  if (snippet) setDraft((prev) => (prev.trim() ? `${prev}\n\n${snippet}` : snippet));
                }}
                className="min-w-0 flex-1 rounded-md border border-white/15 bg-white/5 px-2 py-1 font-mono text-xs text-slate-100 sw-brand-focus outline-none transition [&>option]:bg-white [&>option]:text-slate-900"
              >
                <option value="">Choose an effect to fork…</option>
                {fork.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
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
