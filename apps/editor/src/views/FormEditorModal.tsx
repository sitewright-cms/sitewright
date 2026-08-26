import { useEffect, useMemo, useState } from 'react';
import { useUnsavedWork } from '../lib/unsaved-work';
import { X } from 'lucide-react';
import { DEFAULT_FORM_MODES, isPlatformRoutedMode, type Form, type FormField, type FormMode } from '@sitewright/schema';
import { api, type Project } from '../api';
import { identifierize } from '../lib/entry-form';
import { Modal } from './ui/Modal';
import { useDialogs } from './ui/Dialogs';
import { glassInput, glassPanel, primaryButton, ghostButton, dangerButton, toggleInput } from '../theme';

const FIELD_TYPES: ReadonlyArray<FormField['type']> = [
  'text', 'email', 'tel', 'url', 'number', 'textarea', 'select', 'radio', 'checkbox', 'date', 'time', 'datetime',
];
/** Field types whose entries come from an options list (select/radio, and a checkbox GROUP). */
const OPTION_TYPES = new Set<FormField['type']>(['select', 'radio', 'checkbox']);

const MODE_LABELS: ReadonlyArray<{ value: FormMode; label: string }> = [
  { value: 'globalSmtp', label: 'Platform email (global SMTP)' },
  { value: 'userSmtp', label: 'Platform email (project SMTP)' },
  { value: 'contactPhp', label: 'contact.php (host mail)' },
  { value: 'contactPhpSmtp', label: 'contact.php (SMTP)' },
  { value: 'thirdParty', label: 'Third-party endpoint' },
  { value: 'whatsapp', label: 'WhatsApp (opens the visitor’s WhatsApp)' },
];

type EnabledModes = Record<FormMode, boolean>;

interface FormEditorModalProps {
  project: Project;
  /** The form to edit. */
  form: Form;
  /** Which delivery modes the instance permits, and whether a captcha secret exists. Both are
   *  fetched here when not supplied, so the modal opens standalone from a page or slot preview. */
  enabledModes?: EnabledModes;
  captchaReady?: boolean;
  /** Called after a successful save, with the saved form. */
  onSaved?: (form: Form) => void;
  onClose: () => void;
}

/**
 * The form editor, as a MODAL with explicit Save and Discard.
 *
 * It used to be a view swap inside the Forms tab: opening a form replaced the whole list, and the
 * only way out was a "Cancel" button in the corner. That shape cannot be reached from anywhere else,
 * which is the actual problem — a form is embedded IN a page or a chrome slot, so the place an author
 * wants to edit it is where they can see it. As a modal it opens over the page editor, the skeleton
 * editor or the Forms tab without any of them owning it.
 *
 * Discard confirms only when something was actually changed, so the common "opened it to look" case
 * closes on one click.
 */
export function FormEditorModal({ project, form, enabledModes: modesProp, captchaReady: captchaProp, onSaved, onClose }: FormEditorModalProps) {
  const { confirm, dialog } = useDialogs();
  // Cloned incl. each field, so editing never aliases the caller's row.
  const [draft, setDraft] = useState<Form>(() => ({ ...form, fields: form.fields.map((f) => ({ ...f })) }));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [enabledModes, setEnabledModes] = useState<EnabledModes>(modesProp ?? DEFAULT_FORM_MODES);
  const [captchaReady, setCaptchaReady] = useState(captchaProp ?? true);

  // Opened from a preview there is no Forms tab to have loaded these — fetch what was not handed in.
  useEffect(() => {
    let active = true;
    if (modesProp && captchaProp !== undefined) return;
    void (async () => {
      const [fm, captcha] = await Promise.all([
        api.formModes(project.id).catch(() => ({ formModes: DEFAULT_FORM_MODES })),
        // A client (non-writer) gets a 403 — assume configured rather than warn about a screen they
        // cannot reach.
        api.getProjectCaptcha(project.id).catch(() => ({ captcha: { hasSecret: true } })),
      ]);
      if (!active) return;
      if (!modesProp) setEnabledModes(fm.formModes);
      if (captchaProp === undefined) setCaptchaReady(Boolean(captcha.captcha?.hasSecret));
    })();
    return () => { active = false; };
  }, [project.id, modesProp, captchaProp]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(form), [draft, form]);

  // Guard LEAVING the page too, not just closing this surface — see lib/unsaved-work.
  useUnsavedWork(dirty, 'Form editor');

  function patch(updates: Partial<Form>) {
    setDraft((d) => ({ ...d, ...updates }));
  }
  function patchField(index: number, updates: Partial<FormField>) {
    setDraft((d) => ({ ...d, fields: d.fields.map((f, i) => (i === index ? { ...f, ...updates } : f)) }));
  }
  function addField() {
    setDraft((d) => ({ ...d, fields: [...d.fields, { name: '', label: '', type: 'text', required: false }] }));
  }
  function removeField(index: number) {
    setDraft((d) => ({ ...d, fields: d.fields.filter((_, i) => i !== index) }));
  }

  /** Client-side validation first, so the author gets an inline error rather than a delayed 400. */
  function validate(f: Form): string | null {
    if (f.fields.length === 0) return 'a form needs at least one field';
    const blankName = f.fields.findIndex((x) => x.name === '');
    if (blankName !== -1) return `field ${blankName + 1} needs a name`;
    const blankLabel = f.fields.findIndex((x) => x.label.trim() === '');
    if (blankLabel !== -1) return `field ${blankLabel + 1} needs a label`;
    const names = f.fields.map((x) => x.name);
    const dup = names.find((n, i) => names.indexOf(n) !== i);
    if (dup) return `duplicate field name "${dup}" (names are normalized — make them distinct)`;
    // A radio field is nothing without options (the schema refuses it too) — catch it before the round-trip.
    const radioNoOptions = f.fields.findIndex((x) => x.type === 'radio' && !x.options?.length);
    if (radioNoOptions !== -1) return `field ${radioNoOptions + 1} (radio) needs at least one option`;
    return null;
  }

  async function save() {
    setError(null);
    const next: Form = { ...draft, fields: draft.fields.map((f) => ({ ...f, name: identifierize(f.name) })) };
    const problem = validate(next);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    try {
      await api.putForm(project.id, next);
      onSaved?.(next);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to save form');
    } finally {
      setSaving(false);
    }
  }

  /** The close guard, shared by Discard, ×, Escape and the backdrop so they cannot diverge.
   *  Asks only when there is something to lose, so "opened it to look" still closes in one click. */
  async function allowClose(): Promise<boolean> {
    if (!dirty) return true;
    return confirm({ title: 'Discard changes', message: `Discard your changes to "${draft.id}"?`, confirmLabel: 'Discard' });
  }

  // The header keeps its icon pair (× and ✓, plus the Cmd/Ctrl+S shortcut); the explicit Discard/Save
  // row at the foot is the NAMED version of the same two outcomes, for an author who arrived by
  // clicking a form on the canvas. They carry different accessible names ("Save" vs "Save form") so a
  // screen reader hears two distinguishable controls rather than one duplicated.
  return (
    <Modal
      title={`Edit form — ${draft.id}`}
      size="xl"
      onClose={onClose}
      onBeforeClose={allowClose}
      onSave={() => void save()}
      saving={saving}
    >
      {dialog}
      {/* The Modal shell deliberately supplies NO padding — each modal owns its own, because a
          full-bleed surface (a preview, a code editor) must be able to reach the panel edge. This one
          is a form, and its fields were running into all four edges. */}
      <div className="flex flex-col gap-5 p-5">
      <label className="flex flex-col text-xs text-slate-500 dark:text-slate-400">
        Name
        <input
          aria-label="Form name"
          className={`${glassInput} mt-1`}
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
        />
      </label>

      <label className="flex flex-col text-xs text-slate-500 dark:text-slate-400">
        Recipient email (where submissions are sent — kept server-side)
        <input
          aria-label="Recipient email"
          type="email"
          className={`${glassInput} mt-1`}
          value={draft.recipient}
          onChange={(e) => patch({ recipient: e.target.value })}
          placeholder="leads@acme.com"
          required
        />
      </label>

      <fieldset className={`${glassPanel} p-3`}>
        <legend className="px-1 text-xs font-bold text-slate-500 dark:text-slate-400">Fields</legend>
        <ul className="flex flex-col gap-2">
          {draft.fields.map((field, i) => (
            <li key={i} className="flex flex-col gap-1 border-b border-slate-100 dark:border-white/10 pb-2 text-sm last:border-0">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  aria-label={`Field ${i + 1} name`}
                  className={`${glassInput} w-32 px-2 py-1 font-mono text-xs`}
                  value={field.name}
                  onChange={(e) => patchField(i, { name: e.target.value })}
                  placeholder="email"
                />
                <input
                  aria-label={`Field ${i + 1} label`}
                  className={`${glassInput} w-40 px-2 py-1 text-xs`}
                  value={field.label}
                  onChange={(e) => patchField(i, { label: e.target.value })}
                  placeholder="Your email"
                />
                <select
                  aria-label={`Field ${i + 1} type`}
                  className={`${glassInput} w-auto px-2 py-1 text-xs`}
                  value={field.type}
                  onChange={(e) => patchField(i, { type: e.target.value as FormField['type'] })}
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                  <input
                    type="checkbox"
                    className={toggleInput}
                    aria-label={`Field ${i + 1} required`}
                    checked={field.required}
                    onChange={(e) => patchField(i, { required: e.target.checked })}
                  />
                  required
                </label>
                <button
                  aria-label={`Remove field ${i + 1}`}
                  className={`${dangerButton} ml-auto px-2 py-0.5 text-xs`}
                  onClick={() => removeField(i)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2 pl-1">
                <input
                  aria-label={`Field ${i + 1} placeholder`}
                  className={`${glassInput} w-40 px-2 py-1 text-xs`}
                  value={field.placeholder ?? ''}
                  onChange={(e) => patchField(i, { placeholder: e.target.value || undefined })}
                  placeholder="placeholder (optional)"
                />
                {OPTION_TYPES.has(field.type) && (
                  <input
                    aria-label={`Field ${i + 1} options`}
                    className={`${glassInput} flex-1 px-2 py-1 text-xs`}
                    value={(field.options ?? []).join(', ')}
                    onChange={(e) =>
                      patchField(i, {
                        options: e.target.value
                          .split(',')
                          .map((o) => o.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder={field.type === 'checkbox' ? 'options (blank = single checkbox)' : 'option A, option B, …'}
                  />
                )}
                {field.type === 'checkbox' && (field.options?.length ?? 0) > 0 && field.required && (
                  <span className="w-full text-xs text-amber-600 dark:text-amber-400">
                    “required” isn’t enforced on a multi-select checkbox group (the browser has no “at least one” rule).
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={addField}
          className={`${ghostButton} mt-2`}
        >
          Add field
        </button>
      </fieldset>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col text-xs text-slate-500 dark:text-slate-400">
          Submit button label
          <input
            aria-label="Submit label"
            className={`${glassInput} mt-1`}
            value={draft.submitLabel}
            onChange={(e) => patch({ submitLabel: e.target.value })}
          />
        </label>
        <label className="flex flex-col text-xs text-slate-500 dark:text-slate-400">
          Thank-you redirect (optional; overrides the inline message)
          <input
            aria-label="Redirect URL"
            className={`${glassInput} mt-1`}
            value={draft.redirectUrl ?? ''}
            onChange={(e) => patch({ redirectUrl: e.target.value || undefined })}
            placeholder="/thank-you"
          />
        </label>
        <label className="flex flex-col text-xs text-slate-500 dark:text-slate-400">
          Success message
          <input
            aria-label="Success message"
            className={`${glassInput} mt-1`}
            value={draft.successMessage}
            onChange={(e) => patch({ successMessage: e.target.value })}
          />
        </label>
        <label className="flex flex-col text-xs text-slate-500 dark:text-slate-400">
          Error message
          <input
            aria-label="Error message"
            className={`${glassInput} mt-1`}
            value={draft.errorMessage}
            onChange={(e) => patch({ errorMessage: e.target.value })}
          />
        </label>
      </div>

      <label className="flex max-w-sm flex-col text-xs text-slate-500 dark:text-slate-400">
        Delivery mode
        <select
          aria-label="Delivery mode"
          className={`${glassInput} mt-1`}
          value={draft.mode}
          onChange={(e) => {
            const mode = e.target.value as FormMode;
            // Drop each mode's own delivery field when leaving it, so a stale value never lingers
            // (and, for whatsapp, never reaches the published HTML) under a mode that ignores it.
            patch({
              mode,
              ...(mode === 'thirdParty' ? {} : { thirdPartyUrl: undefined }),
              ...(mode === 'whatsapp' ? {} : { whatsappNumber: undefined, whatsappIntro: undefined }),
            });
          }}
        >
          {MODE_LABELS.filter((m) => enabledModes[m.value] || m.value === draft.mode).map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <span className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
          Only modes enabled by an instance admin are listed.
        </span>
      </label>

      {draft.mode === 'thirdParty' && (
        <label className="flex max-w-lg flex-col text-xs text-slate-500 dark:text-slate-400">
          Third-party endpoint URL (the form posts here directly)
          <input
            aria-label="Third-party endpoint URL"
            type="url"
            className={`${glassInput} mt-1`}
            value={draft.thirdPartyUrl ?? ''}
            onChange={(e) => patch({ thirdPartyUrl: e.target.value || undefined })}
            placeholder="https://formspree.io/f/xxxx"
            required
          />
        </label>
      )}

      {draft.mode === 'whatsapp' && (
        <div className="flex max-w-lg flex-col gap-2">
          <label className="flex flex-col text-xs text-slate-500 dark:text-slate-400">
            WhatsApp number (E.164 — country code, no spaces)
            <input
              aria-label="WhatsApp number"
              className={`${glassInput} mt-1`}
              value={draft.whatsappNumber ?? ''}
              onChange={(e) => patch({ whatsappNumber: e.target.value || undefined })}
              placeholder="+14155550123"
              required
            />
          </label>
          <label className="flex flex-col text-xs text-slate-500 dark:text-slate-400">
            Intro line (optional) — prepended to the compiled message
            <input
              aria-label="WhatsApp intro line"
              className={`${glassInput} mt-1`}
              value={draft.whatsappIntro ?? ''}
              onChange={(e) => patch({ whatsappIntro: e.target.value || undefined })}
              placeholder="New enquiry from the website"
            />
          </label>
          <p className="rounded-lg border border-amber-200/70 dark:border-amber-500/20 bg-amber-50/60 dark:bg-amber-500/10 p-2 text-[11px] text-slate-600 dark:text-slate-300">
            The visitor's own WhatsApp opens with the message pre-filled — <strong>they still have to press
            send</strong>, and nothing is stored in the inbox or emailed. The number is visible in the page
            source, as any published phone number is.
          </p>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className={toggleInput}
          aria-label="Require a captcha"
          checked={draft.captcha}
          disabled={!isPlatformRoutedMode(draft.mode)}
          onChange={(e) => patch({ captcha: e.target.checked })}
        />
        <span className={!isPlatformRoutedMode(draft.mode) ? 'text-slate-500 dark:text-slate-400' : ''}>
          Require a captcha (which one is set per project, in Captcha below)
          {!isPlatformRoutedMode(draft.mode) &&
            ' — not available for this mode (the platform can’t verify a remote endpoint)'}
        </span>
      </label>
      {draft.captcha && isPlatformRoutedMode(draft.mode) && !captchaReady && (
        <p className="rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-200">
          This project has no captcha configured, so this form will reject every submission. Set a provider and
          keys in <strong>Captcha</strong> below, or turn this off.
        </p>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className={toggleInput}
          aria-label="Require proof of work"
          checked={draft.pow}
          disabled={!isPlatformRoutedMode(draft.mode)}
          onChange={(e) => patch({ pow: e.target.checked })}
        />
        <span className={!isPlatformRoutedMode(draft.mode) ? 'text-slate-500 dark:text-slate-400' : ''}>
          Require proof of work (no third party, no keys — the visitor’s browser spends a moment of CPU)
          {!isPlatformRoutedMode(draft.mode)
            ? ' — not available for this mode (the platform can’t verify a remote endpoint)'
            : ' — needs HTTPS (the browser crypto it uses is unavailable on plain http), and is best left off unless the filtered count says you need it'}
        </span>
      </label>

        {/* Explicit actions as well as the header's save/close icons: this modal is reached from a
            page or slot preview, where an author has just clicked a form on the canvas and needs the
            two outcomes named rather than inferred from icons. */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 dark:border-white/10 pt-4">
          {error ? <span className="text-sm text-red-600 dark:text-red-400">{error}</span> : <span />}
          <div className="flex items-center gap-2">
            <button type="button" className={ghostButton} onClick={() => void (async () => { if (await allowClose()) onClose(); })()} disabled={saving}>
              Discard
            </button>
            <button type="button" className={primaryButton} onClick={() => void save()} disabled={saving}>
              {saving ? 'Saving…' : 'Save form'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
