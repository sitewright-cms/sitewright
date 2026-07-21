import { useRef, useState } from 'react';
import { api, type Project } from '../api';
import { glassInput } from '../theme';
import { Modal } from './ui/Modal';
import { Tabs } from './ui/Tabs';
import { AiConfig } from './AiConfig';
import { useDialogs } from './ui/Dialogs';

interface ProjectSettingsModalProps {
  project: Project;
  /** Every OTHER project's slug in the instance, to reject a colliding slug client-side. */
  existingSlugs: ReadonlySet<string>;
  /** Called with the updated project after a successful rename (the id is unchanged; reselect it). */
  onSaved: (updated: Project) => void | Promise<void>;
  onClose: () => void;
}

// The project slug allow-list (mirrors the server's slug regex): lowercase alphanumeric groups joined by
// single hyphens — the value that appears in the site URL (`/sites/<slug>/`, `<slug>.<domain>`).
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * PROJECT SETTINGS — rename a project's display NAME and/or its SLUG. The name is cosmetic (it also updates
 * the on-site company name). Changing the slug is a heavier, server-side operation: the site URL changes and
 * every `/media/<slug>/…` reference + the media binaries are rewritten/moved so nothing breaks. Because the
 * slug is a deliberate change, it's committed via an explicit confirming button when it differs.
 */
export function ProjectSettingsModal({ project, existingSlugs, onSaved, onClose }: ProjectSettingsModalProps) {
  const { confirm, dialog } = useDialogs();
  const [tab, setTab] = useState<'general' | 'ai'>('general');
  const [name, setName] = useState(project.name);
  const [slugInput, setSlugInput] = useState(project.slug);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);

  const slug = slugInput.trim().toLowerCase();
  const slugChanged = slug !== project.slug;
  const slugValid = SLUG_RE.test(slug);
  const slugTaken = slugChanged && existingSlugs.has(slug);
  const trimmedName = name.trim();
  const nameInvalid = trimmedName === '';
  const nameChanged = trimmedName !== project.name;
  const dirty = nameChanged || slugChanged;
  const blocked = nameInvalid || (slugChanged && (!slugValid || slugTaken));

  async function run() {
    if (submitting.current || blocked || !dirty) return;
    submitting.current = true;
    setSaving(true);
    setError(null);
    try {
      const { project: updated } = await api.updateProject(project.id, {
        ...(nameChanged ? { name: trimmedName } : {}),
        ...(slugChanged ? { slug } : {}),
      });
      await onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to update project');
    } finally {
      setSaving(false);
      submitting.current = false;
    }
  }

  async function confirmClose(): Promise<boolean> {
    if (!dirty) return true;
    return confirm({ title: 'Discard changes', message: 'Discard the project changes?', confirmLabel: 'Discard' });
  }

  return (
    <Modal
      title="Project Settings"
      size="lg"
      onClose={onClose}
      onBeforeClose={confirmClose}
      // Header Save applies to the GENERAL tab only (name; a slug change is committed via the explicit
      // button below so the URL change is deliberate). The AI tab self-saves, so the header Save is hidden.
      onSave={tab === 'general' && !slugChanged ? () => void run() : undefined}
      saving={saving}
      saveDisabled={!dirty || nameInvalid}
      saveLabel="Save"
    >
      <div className="px-5 pt-4">
        <Tabs
          ariaLabel="Project settings sections"
          active={tab}
          onSelect={setTab}
          tabs={[
            { id: 'general', label: 'General' },
            { id: 'ai', label: 'AI Assistant' },
          ]}
        />
      </div>
      {tab === 'ai' ? (
        <div className="p-5">
          <AiConfig projectId={project.id} flat />
        </div>
      ) : (
      <div className="flex flex-col gap-3 p-5">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">Project name</span>
          <input aria-label="Project name" className={glassInput} value={name} onChange={(e) => setName(e.target.value)} />
          {nameInvalid && nameChanged && <span className="text-[11px] text-rose-500">Name cannot be empty.</span>}
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">
            Slug <span className="text-slate-300">— the site address (<code>/sites/&lt;slug&gt;/</code>)</span>
          </span>
          <input
            aria-label="Project slug"
            className={glassInput}
            value={slugInput}
            onChange={(e) => setSlugInput(e.target.value)}
            placeholder={project.slug}
          />
          <span className={`text-[11px] ${slugChanged && (!slugValid || slugTaken) ? 'text-rose-500' : 'text-slate-400'}`}>
            {slugChanged && !slugValid
              ? 'Use only lowercase letters, numbers, and single hyphens, e.g. my-agency-site.'
              : slugTaken
                ? `“${slug}” is already used by another project.`
                : 'Lowercase letters, numbers, and hyphens only (e.g. my-agency-site).'}
          </span>
        </label>

        {slugChanged && slugValid && !slugTaken && (
          <div className="flex flex-col gap-2 rounded-lg bg-amber-50 px-3 py-3 text-[11px] leading-relaxed text-amber-800">
            <p>
              Changing the slug to <code>{slug}</code> changes the site address and rewrites every media
              reference. Any external links to the old address will stop working, and you'll need to publish
              again to serve at the new address.
            </p>
            <button
              type="button"
              disabled={saving || blocked}
              onClick={() => void run()}
              className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
            >
              Rename project + change slug
            </button>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
      )}
      {dialog}
    </Modal>
  );
}
