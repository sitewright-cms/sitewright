import { useEffect, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import type { Form, FormField, FormMode } from '@sitewright/schema';
import { api, type Project } from '../api';
import { useProjectEvents } from '../lib/use-project-events';
import { identifierize, slugify } from '../lib/entry-form';
import { ProjectSmtp } from './ProjectSmtp';
import { SubmissionsInbox } from './SubmissionsInbox';
import { useDialogs } from './ui/Dialogs';
import { SkeletonList } from './ui/Skeleton';
import { glassCard, glassPanel, glassInput, primaryButton, ghostButton, dangerButton, toggleInput, gradientHover } from '../theme';

const FIELD_TYPES: ReadonlyArray<FormField['type']> = ['text', 'email', 'tel', 'url', 'number', 'textarea', 'select', 'radio', 'checkbox'];
/** Field types whose entries come from an options list (select/radio, and a checkbox GROUP). */
const OPTION_TYPES = new Set<FormField['type']>(['select', 'radio', 'checkbox']);

const MODE_LABELS: ReadonlyArray<{ value: FormMode; label: string }> = [
  { value: 'globalSmtp', label: 'Platform email (global SMTP)' },
  { value: 'userSmtp', label: 'Platform email (project SMTP)' },
  { value: 'contactPhp', label: 'contact.php (host mail)' },
  { value: 'thirdParty', label: 'Third-party endpoint' },
];

type EnabledModes = Record<FormMode, boolean>;

/** A fresh form definition with sensible defaults (matches the schema defaults). */
function emptyForm(id: string, name: string): Form {
  return {
    id,
    name,
    fields: [{ name: 'email', label: 'Email', type: 'email', required: true }],
    submitLabel: 'Send',
    successMessage: 'Thank you — your message has been sent.',
    errorMessage: 'Sorry, something went wrong. Please try again.',
    recipient: '',
    mode: 'globalSmtp',
    hcaptcha: false,
  };
}

/**
 * Forms tab: list project forms and create/edit a form definition (fields,
 * inline messages, recipient, redirect, hCaptcha). The recipient is server-side
 * config — it round-trips here for authoring but is never rendered into the
 * exported site.
 */
export function FormsManager({ project }: { project: Project }) {
  const { confirm, dialog } = useDialogs();
  const [forms, setForms] = useState<Form[]>([]);
  // Matches the server default (all off); the real values arrive from api.formModes
  // before the editor is reachable (the list view is gated on `loading`).
  const [enabledModes, setEnabledModes] = useState<EnabledModes>({ globalSmtp: false, userSmtp: false, contactPhp: false, thirdParty: false });
  const [draft, setDraft] = useState<Form | null>(null);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  // Which form's submissions are expanded inline (the folded-in inbox).
  const [submissionsFor, setSubmissionsFor] = useState<string | null>(null);

  async function load(isActive: () => boolean = () => true) {
    try {
      const [res, fm] = await Promise.all([api.listForms(project.id), api.formModes(project.id)]);
      if (!isActive()) return;
      setForms(res.items);
      setEnabledModes(fm.formModes);
    } catch (err) {
      if (isActive()) setError(err instanceof Error ? err.message : 'failed to load forms');
    } finally {
      if (isActive()) setLoading(false);
    }
  }
  useEffect(() => {
    let active = true;
    void load(() => active);
    return () => {
      active = false;
    };
  }, [project.id]);

  // LIVE-REFRESH the forms list when an agent (or another tab) adds/edits/removes a form.
  useProjectEvents(project.id, (c) => {
    if (c.kind === 'form') void load();
  });

  function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const id = slugify(newName);
    if (!id) {
      setError('form name must contain letters or numbers');
      return;
    }
    if (forms.some((f) => f.id === id)) {
      setError(`a form "${id}" already exists`);
      return;
    }
    setDraft(emptyForm(id, newName));
    setNewName('');
  }

  function patch(updates: Partial<Form>) {
    setDraft((d) => (d ? { ...d, ...updates } : d));
  }

  function patchField(index: number, updates: Partial<FormField>) {
    setDraft((d) =>
      d ? { ...d, fields: d.fields.map((f, i) => (i === index ? { ...f, ...updates } : f)) } : d,
    );
  }

  function addField() {
    setDraft((d) => (d ? { ...d, fields: [...d.fields, { name: '', label: '', type: 'text', required: false }] } : d));
  }

  function removeField(index: number) {
    setDraft((d) => (d ? { ...d, fields: d.fields.filter((_, i) => i !== index) } : d));
  }

  async function save() {
    if (!draft) return;
    setError(null);
    setSaved(false);
    // Normalize field names to safe identifiers, then validate client-side so the
    // author gets an inline error instead of a delayed server 400.
    const form: Form = { ...draft, fields: draft.fields.map((f) => ({ ...f, name: identifierize(f.name) })) };
    if (form.fields.length === 0) {
      setError('a form needs at least one field');
      return;
    }
    const blankName = form.fields.findIndex((f) => f.name === '');
    if (blankName !== -1) {
      setError(`field ${blankName + 1} needs a name`);
      return;
    }
    const blankLabel = form.fields.findIndex((f) => f.label.trim() === '');
    if (blankLabel !== -1) {
      setError(`field ${blankLabel + 1} needs a label`);
      return;
    }
    const names = form.fields.map((f) => f.name);
    const dup = names.find((n, i) => names.indexOf(n) !== i);
    if (dup) {
      setError(`duplicate field name "${dup}" (names are normalized — make them distinct)`);
      return;
    }
    // A radio field is nothing without options (the schema also refuses it) — catch it before the round-trip.
    const radioNoOptions = form.fields.findIndex((f) => f.type === 'radio' && !f.options?.length);
    if (radioNoOptions !== -1) {
      setError(`field ${radioNoOptions + 1} (radio) needs at least one option`);
      return;
    }
    try {
      await api.putForm(project.id, form);
      setSaved(true);
      setDraft(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to save form');
    }
  }

  async function remove(id: string) {
    if (!(await confirm({ title: 'Delete form', message: `Delete form "${id}"? Existing submissions are kept.`, confirmLabel: 'Delete' }))) return;
    setError(null);
    try {
      await api.deleteForm(project.id, id);
      if (draft?.id === id) setDraft(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to delete form');
    }
  }

  if (loading) return <SkeletonList rows={3} label="Loading forms…" />;

  if (draft) {
    return (
      <div className={`flex flex-col gap-5 ${glassCard} p-5`}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-700">
            Edit form <code className="text-xs text-slate-400">{draft.id}</code>
          </h3>
          <button className={ghostButton} onClick={() => setDraft(null)}>
            Cancel
          </button>
        </div>

        <label className="flex flex-col text-xs text-slate-500">
          Name
          <input
            aria-label="Form name"
            className={`${glassInput} mt-1`}
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </label>

        <label className="flex flex-col text-xs text-slate-500">
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
          <legend className="px-1 text-xs font-bold text-slate-500">Fields</legend>
          <ul className="flex flex-col gap-2">
            {draft.fields.map((field, i) => (
              <li key={i} className="flex flex-col gap-1 border-b border-slate-100 pb-2 text-sm last:border-0">
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
                  <label className="flex items-center gap-1.5 text-xs text-slate-500">
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
                    <span className="w-full text-xs text-amber-600">
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

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col text-xs text-slate-500">
            Submit button label
            <input
              aria-label="Submit label"
              className={`${glassInput} mt-1`}
              value={draft.submitLabel}
              onChange={(e) => patch({ submitLabel: e.target.value })}
            />
          </label>
          <label className="flex flex-col text-xs text-slate-500">
            Thank-you redirect (optional; overrides the inline message)
            <input
              aria-label="Redirect URL"
              className={`${glassInput} mt-1`}
              value={draft.redirectUrl ?? ''}
              onChange={(e) => patch({ redirectUrl: e.target.value || undefined })}
              placeholder="/thank-you"
            />
          </label>
          <label className="flex flex-col text-xs text-slate-500">
            Success message
            <input
              aria-label="Success message"
              className={`${glassInput} mt-1`}
              value={draft.successMessage}
              onChange={(e) => patch({ successMessage: e.target.value })}
            />
          </label>
          <label className="flex flex-col text-xs text-slate-500">
            Error message
            <input
              aria-label="Error message"
              className={`${glassInput} mt-1`}
              value={draft.errorMessage}
              onChange={(e) => patch({ errorMessage: e.target.value })}
            />
          </label>
        </div>

        <label className="flex max-w-sm flex-col text-xs text-slate-500">
          Delivery mode
          <select
            aria-label="Delivery mode"
            className={`${glassInput} mt-1`}
            value={draft.mode}
            onChange={(e) => {
              const mode = e.target.value as FormMode;
              // Drop the third-party URL when leaving thirdParty so it never lingers
              // (and never reaches the published HTML) for another mode.
              patch(mode === 'thirdParty' ? { mode } : { mode, thirdPartyUrl: undefined });
            }}
          >
            {MODE_LABELS.filter((m) => enabledModes[m.value] || m.value === draft.mode).map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <span className="mt-1 text-[11px] text-slate-400">
            Only modes enabled by an instance admin are listed.
          </span>
        </label>

        {draft.mode === 'thirdParty' && (
          <label className="flex max-w-lg flex-col text-xs text-slate-500">
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

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className={toggleInput}
            aria-label="Require hCaptcha"
            checked={draft.hcaptcha}
            disabled={draft.mode === 'contactPhp' || draft.mode === 'thirdParty'}
            onChange={(e) => patch({ hcaptcha: e.target.checked })}
          />
          <span className={draft.mode === 'contactPhp' || draft.mode === 'thirdParty' ? 'text-slate-400' : ''}>
            Require hCaptcha (uses the instance hCaptcha keys; configured by an admin)
            {(draft.mode === 'contactPhp' || draft.mode === 'thirdParty') &&
              ' — not available for this mode (the platform can’t verify a remote endpoint)'}
          </span>
        </label>

        <div className="flex items-center gap-3">
          <button onClick={save} className={primaryButton}>
            Save form
          </button>
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </div>
    );
  }

  // Open a form in the editor draft — cloned (incl. each field) so editing never aliases the list row.
  // Shared by the whole-row click and the name button so the two can't diverge.
  const openForm = (f: (typeof forms)[number]) => {
    setSaved(false);
    setDraft({ ...f, fields: f.fields.map((field) => ({ ...field })) });
  };

  return (
    <div className="flex flex-col gap-4">
      {dialog}
      {/* Per-project SMTP config — only relevant when the admin enabled the userSmtp mode. */}
      {enabledModes.userSmtp && <ProjectSmtp project={project} />}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {saved && <p className="text-sm text-green-600">Saved.</p>}
      <ul className="flex flex-col gap-2">
        {forms.map((f, i) => {
          const showing = submissionsFor === f.id;
          return (
            <li
              key={f.id}
              className="sw-stack-in flex flex-col gap-2"
              style={{ animationDelay: `${Math.min(i, 24) * 35}ms` }}
            >
              {/* The whole row opens the editor (wrapper onClick + gradient-lift hover + ripple, matching
                  the Datasets/Pages rows); the name stays a real keyboard-accessible button and the
                  action buttons stopPropagation so they don't also open the editor. */}
              <div
                className={`group flex cursor-pointer items-center gap-3 ${glassCard} ${gradientHover} waves-effect px-4 py-3 text-sm transition`}
                onClick={() => openForm(f)}
              >
                <button
                  className="text-left font-medium group-hover:text-white"
                  onClick={(e) => {
                    e.stopPropagation();
                    openForm(f);
                  }}
                >
                  {f.name}
                </button>
                <code className="text-xs text-slate-400 group-hover:text-white/80">{f.id}</code>
                <span className="text-xs text-slate-500 group-hover:text-white/90">{f.fields.length} fields</span>
                {f.hcaptcha && (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase transition group-hover:bg-white/25 group-hover:text-white">
                    hCaptcha
                  </span>
                )}
                <button
                  aria-label={`${showing ? 'Hide' : 'Show'} submissions for ${f.id}`}
                  aria-expanded={showing}
                  className={`${ghostButton} ml-auto text-xs`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSubmissionsFor(showing ? null : f.id);
                  }}
                >
                  {showing ? 'Hide submissions' : 'Show submissions'}
                </button>
                <button
                  aria-label={`Delete form ${f.id}`}
                  className={`${dangerButton} group-hover:text-white`}
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(f.id);
                  }}
                >
                  Delete
                </button>
              </div>
              {showing && (
                <div className={`${glassCard} px-4 py-3`}>
                  <SubmissionsInbox key={f.id} project={project} formId={f.id} />
                </div>
              )}
            </li>
          );
        })}
        {forms.length === 0 && <li className="text-sm text-slate-400">No forms yet. Create one, then add a Form block to a page.</li>}
      </ul>

      <form onSubmit={create} className={`flex flex-wrap items-end gap-2 ${glassCard} p-4`}>
        <div className="flex flex-col">
          <label className="text-xs text-slate-500">New form name</label>
          <input
            aria-label="New form name"
            className={`${glassInput} mt-1`}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Contact"
            required
          />
        </div>
        <button type="submit" className={primaryButton}>
          Create form
        </button>
      </form>
    </div>
  );
}
