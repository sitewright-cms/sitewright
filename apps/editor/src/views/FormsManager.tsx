import { useEffect, useState, type FormEvent } from 'react';
import type { Form, FormField } from '@sitewright/schema';
import { api, type Org, type Project } from '../api';
import { identifierize, slugify } from '../lib/entry-form';

const FIELD_TYPES: ReadonlyArray<FormField['type']> = ['text', 'email', 'tel', 'url', 'number', 'textarea', 'select'];

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
export function FormsManager({ org, project }: { org: Org; project: Project }) {
  const [forms, setForms] = useState<Form[]>([]);
  const [draft, setDraft] = useState<Form | null>(null);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load(isActive: () => boolean = () => true) {
    try {
      const res = await api.listForms(org.id, project.id);
      if (isActive()) setForms(res.items);
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
  }, [org.id, project.id]);

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
    try {
      await api.putForm(org.id, project.id, form);
      setSaved(true);
      setDraft(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to save form');
    }
  }

  async function remove(id: string) {
    if (!window.confirm(`Delete form "${id}"? Existing submissions are kept.`)) return;
    setError(null);
    try {
      await api.deleteForm(org.id, project.id, id);
      if (draft?.id === id) setDraft(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to delete form');
    }
  }

  if (loading) return <p className="text-sm text-slate-400">Loading forms…</p>;

  if (draft) {
    return (
      <div className="flex flex-col gap-5 rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">
            Edit form <code className="text-xs text-slate-400">{draft.id}</code>
          </h3>
          <button className="text-xs text-slate-500 hover:text-slate-900" onClick={() => setDraft(null)}>
            Cancel
          </button>
        </div>

        <label className="flex flex-col text-xs text-slate-500">
          Name
          <input
            aria-label="Form name"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </label>

        <label className="flex flex-col text-xs text-slate-500">
          Recipient email (where submissions are sent — kept server-side)
          <input
            aria-label="Recipient email"
            type="email"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={draft.recipient}
            onChange={(e) => patch({ recipient: e.target.value })}
            placeholder="leads@acme.com"
            required
          />
        </label>

        <fieldset className="rounded-md border border-slate-200 p-3">
          <legend className="px-1 text-xs font-semibold text-slate-500">Fields</legend>
          <ul className="flex flex-col gap-2">
            {draft.fields.map((field, i) => (
              <li key={i} className="flex flex-col gap-1 border-b border-slate-100 pb-2 text-sm last:border-0">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    aria-label={`Field ${i + 1} name`}
                    className="w-32 rounded-md border border-slate-300 px-2 py-1 font-mono text-xs"
                    value={field.name}
                    onChange={(e) => patchField(i, { name: e.target.value })}
                    placeholder="email"
                  />
                  <input
                    aria-label={`Field ${i + 1} label`}
                    className="w-40 rounded-md border border-slate-300 px-2 py-1 text-xs"
                    value={field.label}
                    onChange={(e) => patchField(i, { label: e.target.value })}
                    placeholder="Your email"
                  />
                  <select
                    aria-label={`Field ${i + 1} type`}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                    value={field.type}
                    onChange={(e) => patchField(i, { type: e.target.value as FormField['type'] })}
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1 text-xs text-slate-500">
                    <input
                      type="checkbox"
                      aria-label={`Field ${i + 1} required`}
                      checked={field.required}
                      onChange={(e) => patchField(i, { required: e.target.checked })}
                    />
                    required
                  </label>
                  <button
                    aria-label={`Remove field ${i + 1}`}
                    className="ml-auto text-xs text-red-400 hover:text-red-700"
                    onClick={() => removeField(i)}
                  >
                    ✕
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2 pl-1">
                  <input
                    aria-label={`Field ${i + 1} placeholder`}
                    className="w-40 rounded-md border border-slate-200 px-2 py-1 text-xs"
                    value={field.placeholder ?? ''}
                    onChange={(e) => patchField(i, { placeholder: e.target.value || undefined })}
                    placeholder="placeholder (optional)"
                  />
                  {field.type === 'select' && (
                    <input
                      aria-label={`Field ${i + 1} options`}
                      className="flex-1 rounded-md border border-slate-200 px-2 py-1 text-xs"
                      value={(field.options ?? []).join(', ')}
                      onChange={(e) =>
                        patchField(i, {
                          options: e.target.value
                            .split(',')
                            .map((o) => o.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="option A, option B, …"
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={addField}
            className="mt-2 rounded-md border border-slate-300 px-3 py-1 text-xs hover:border-slate-500"
          >
            Add field
          </button>
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col text-xs text-slate-500">
            Submit button label
            <input
              aria-label="Submit label"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={draft.submitLabel}
              onChange={(e) => patch({ submitLabel: e.target.value })}
            />
          </label>
          <label className="flex flex-col text-xs text-slate-500">
            Thank-you redirect (optional; overrides the inline message)
            <input
              aria-label="Redirect URL"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={draft.redirectUrl ?? ''}
              onChange={(e) => patch({ redirectUrl: e.target.value || undefined })}
              placeholder="/thank-you"
            />
          </label>
          <label className="flex flex-col text-xs text-slate-500">
            Success message
            <input
              aria-label="Success message"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={draft.successMessage}
              onChange={(e) => patch({ successMessage: e.target.value })}
            />
          </label>
          <label className="flex flex-col text-xs text-slate-500">
            Error message
            <input
              aria-label="Error message"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={draft.errorMessage}
              onChange={(e) => patch({ errorMessage: e.target.value })}
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            aria-label="Require hCaptcha"
            checked={draft.hcaptcha}
            onChange={(e) => patch({ hcaptcha: e.target.checked })}
          />
          Require hCaptcha (uses the instance hCaptcha keys; configured by an admin)
        </label>

        <div className="flex items-center gap-3">
          <button onClick={save} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
            Save form
          </button>
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-red-600">{error}</p>}
      {saved && <p className="text-sm text-green-600">Saved.</p>}
      <ul className="flex flex-col gap-2">
        {forms.map((f) => (
          <li
            key={f.id}
            className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm"
          >
            <button
              className="text-left font-medium hover:underline"
              onClick={() => {
                setSaved(false);
                // Clone (incl. each field) so editing the draft never aliases the list row.
                setDraft({ ...f, fields: f.fields.map((field) => ({ ...field })) });
              }}
            >
              {f.name}
            </button>
            <code className="text-xs text-slate-400">{f.id}</code>
            <span className="text-xs text-slate-500">{f.fields.length} fields</span>
            {f.hcaptcha && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase">hCaptcha</span>}
            <button
              aria-label={`Delete form ${f.id}`}
              className="ml-auto text-xs text-red-500 hover:text-red-700"
              onClick={() => remove(f.id)}
            >
              Delete
            </button>
          </li>
        ))}
        {forms.length === 0 && <li className="text-sm text-slate-400">No forms yet. Create one, then add a Form block to a page.</li>}
      </ul>

      <form onSubmit={create} className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-col">
          <label className="text-xs text-slate-500">New form name</label>
          <input
            aria-label="New form name"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Contact"
            required
          />
        </div>
        <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
          Create form
        </button>
      </form>
    </div>
  );
}
