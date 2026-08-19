import { useEffect, useState, type FormEvent } from 'react';
import { DEFAULT_FORM_MODES, type Form, type FormMode } from '@sitewright/schema';
import { api, type Project } from '../api';
import { useProjectEvents } from '../lib/use-project-events';
import { slugify } from '../lib/entry-form';
import { ProjectSmtp } from './ProjectSmtp';
import { ProjectCaptcha } from './ProjectCaptcha';
import { SubmissionsInbox } from './SubmissionsInbox';
import { FormEditorModal } from './FormEditorModal';
import { useDialogs } from './ui/Dialogs';
import { SkeletonList } from './ui/Skeleton';
import { glassCard, glassInput, primaryButton, ghostButton, dangerButton, gradientHover } from '../theme';

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
    captcha: false, pow: false,
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
  const [enabledModes, setEnabledModes] = useState<EnabledModes>(DEFAULT_FORM_MODES);
  const [draft, setDraft] = useState<Form | null>(null);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Surfaced here too: an author lands on Forms to ask "is this form working?", and a silent
  // delivery failure is exactly the answer they are looking for.
  const [owed, setOwed] = useState<{ count: number; lastError: string | null }>({ count: 0, lastError: null });
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  // Which form's submissions are expanded inline (the folded-in inbox).
  const [submissionsFor, setSubmissionsFor] = useState<string | null>(null);
  // What the bot traps filtered, per form. The inbox shows only what got THROUGH, so without this an
  // operator cannot tell a QUIET form (nobody is writing) from a FILTERED one (everybody is, and
  // something is eating it) — and cannot answer a client who says they submitted and heard nothing.
  const [filtered, setFiltered] = useState<Array<{ formId: string; reason: string; count: number; lastAt: number }>>([]);
  // Whether this PROJECT has a usable captcha (provider + secret). A form may require a captcha the
  // project has not configured — the widget is then withheld and the endpoint fails CLOSED, which is
  // the safe answer but leaves a visitor stuck on an error they cannot resolve. The author is the only
  // one who can fix it, so they have to be told.
  const [captchaReady, setCaptchaReady] = useState(true);

  async function load(isActive: () => boolean = () => true) {
    try {
      const [res, fm, undelivered, filtered, captcha] = await Promise.all([
        api.listForms(project.id),
        api.formModes(project.id),
        api.undeliveredSubmissions(project.id).catch(() => ({ count: 0, lastError: null })),
        // Never fatal to the tab: a counter is reporting, and losing it must not hide the forms.
        api.filteredSubmissions(project.id).catch(() => ({ total: 0, items: [] })),
        // A client (non-writer) gets a 403 here; assume configured rather than showing them a warning
        // about a screen they cannot reach.
        api.getProjectCaptcha(project.id).catch(() => ({ captcha: { hasSecret: true } })),
      ]);

      if (!isActive()) return;
      setOwed(undelivered);
      setFiltered(filtered.items);
      setForms(res.items);
      setEnabledModes(fm.formModes);
      setCaptchaReady(Boolean(captcha.captcha?.hasSecret));
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

  // Open a form in the editor draft — cloned (incl. each field) so editing never aliases the list row.
  // Shared by the whole-row click and the name button so the two can't diverge.
  const openForm = (f: (typeof forms)[number]) => {
    setSaved(false);
    setDraft({ ...f, fields: f.fields.map((field) => ({ ...field })) });
  };

  return (
    <div className="flex flex-col gap-4">
      {dialog}
      {/* The editor is a MODAL over the list, not a view swap: the list stays visible behind it, and
          the same component is what a page/skeleton preview opens when a form on the canvas is clicked. */}
      {draft && (
        <FormEditorModal
          project={project}
          form={draft}
          enabledModes={enabledModes}
          captchaReady={captchaReady}
          onSaved={() => {
            setSaved(true);
            void load();
          }}
          onClose={() => setDraft(null)}
        />
      )}
      {/* Per-project SMTP config. BOTH modes that send with the project's own credentials need it:
          `userSmtp` (the platform mailer sends) and `contactPhpSmtp` (the exported contact.php
          sends). They read the same stored record, and `contactPhpSmtp` is deliberately a separate
          admin permission rather than one `userSmtp` implies — so gating this panel on `userSmtp`
          alone left an instance that enabled only the php mode able to CHOOSE it with nowhere to
          enter a password, and the resulting 409 pointed at settings that were not on screen. */}
      {(enabledModes.userSmtp || enabledModes.contactPhpSmtp) && <ProjectSmtp project={project} />}
      <ProjectCaptcha project={project} />
      {owed.count > 0 && (
        <p className="text-sm text-amber-700 dark:text-amber-400" role="status">
          ⚠ {owed.count} submission{owed.count === 1 ? '' : 's'} could not be emailed
          {owed.lastError ? ` — ${owed.lastError}` : '.'} Open the Submissions tab to resend.
        </p>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {saved && <p className="text-sm text-green-600 dark:text-green-400">Saved.</p>}
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
                className={`group flex items-center gap-3 ${glassCard} ${gradientHover} waves-effect px-4 py-3 text-sm transition ${
                  f.managed ? '' : 'cursor-pointer'
                }`}
                onClick={f.managed ? undefined : () => openForm(f)}
              >
                <button
                  className="text-left font-medium group-hover:text-white disabled:cursor-default"
                  disabled={f.managed !== undefined}
                  title={f.managed ? 'Managed by the Shop — edit it in Website settings → Shop' : undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    openForm(f);
                  }}
                >
                  {f.name}
                </button>
                <code className="text-xs text-slate-500 dark:text-slate-400 group-hover:text-white/80">{f.id}</code>
                <span className="text-xs text-slate-500 dark:text-slate-400 group-hover:text-white/90">{f.fields.length} fields</span>
                {f.pow && (
                  <span className="rounded bg-slate-100 dark:bg-white/10 px-1.5 py-0.5 text-[10px] uppercase transition group-hover:bg-white/25 group-hover:text-white">
                    PoW
                  </span>
                )}
                {f.captcha && (
                  <span className="rounded bg-slate-100 dark:bg-white/10 px-1.5 py-0.5 text-[10px] uppercase transition group-hover:bg-white/25 group-hover:text-white">
                    Captcha
                  </span>
                )}
                {/* A form the SHOP owns. It is listed because its orders land in the inbox and you need
                    to recognise them — but it is provisioned from the shop settings on every save, so
                    editing it here would be overwritten. The badge says where it is actually edited. */}
                {f.managed === 'shop' && (
                  <span
                    title="Provisioned from Website settings → Shop → Checkout channels. Edit it there; changes made here would be overwritten on the next save."
                    className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] uppercase text-indigo-700 transition dark:bg-indigo-400/15 dark:text-indigo-300 group-hover:bg-white/25 group-hover:text-white"
                  >
                    Shop
                  </span>
                )}
                {(() => {
                  const rows = filtered.filter((r) => r.formId === f.id);
                  const total = rows.reduce((n, r) => n + r.count, 0);
                  if (total === 0) return null;
                  const breakdown = rows.map((r) => `${r.count} ${r.reason}`).join(', ');
                  return (
                    <span
                      title={`Filtered before storage: ${breakdown}. These never became submissions and nobody was emailed.`}
                      className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800 transition dark:bg-amber-400/15 dark:text-amber-300 group-hover:bg-white/25 group-hover:text-white"
                    >
                      {total} filtered
                    </span>
                  );
                })()}
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
        {forms.length === 0 && <li className="text-sm text-slate-500 dark:text-slate-400">No forms yet. Create one, then add a Form block to a page.</li>}
      </ul>

      <form onSubmit={create} className={`flex flex-wrap items-end gap-2 ${glassCard} p-4`}>
        <div className="flex flex-col">
          <label className="text-xs text-slate-500 dark:text-slate-400">New form name</label>
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
