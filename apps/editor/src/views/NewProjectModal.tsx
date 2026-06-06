import { useState } from 'react';
import { api, type Project } from '../api';
import { Modal } from './ui/Modal';
import { glassInput } from '../theme';

/** Lowercases + hyphenates a name into a URL-safe slug (matches the API's slug rule). */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

interface NewProjectModalProps {
  onClose: () => void;
  /** Receives the freshly-created project so the app can open it immediately. */
  onCreated: (project: Project) => void;
}

/**
 * Create a project from a modal: a name + an auto-derived (editable) slug. The new
 * project is seeded server-side with a default blue brand + a HOME page, so it opens
 * ready to edit. On success the caller auto-opens it.
 */
export function NewProjectModal({ onClose, onCreated }: NewProjectModalProps) {
  const [name, setName] = useState('');
  // `slugEdited` tracks whether the user has overridden the auto-slug.
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveSlug = slugEdited ? slug : slugify(name);

  async function create() {
    if (!name.trim() || !effectiveSlug) return;
    setSaving(true);
    setError(null);
    try {
      const { project } = await api.createProject(name.trim(), effectiveSlug);
      onCreated(project);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to create project');
      setSaving(false);
    }
  }

  return (
    <Modal title="New project" size="md" onClose={onClose} onSave={() => void create()} saving={saving} saveDisabled={!name.trim() || !effectiveSlug} saveLabel="Create project">
      <form
        className="flex flex-col gap-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <label className="flex flex-col text-xs font-semibold text-slate-700">
          Project name
          <input aria-label="Project name" className={`mt-1.5 font-normal ${glassInput}`} value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        </label>
        <label className="flex flex-col text-xs font-semibold text-slate-700">
          Slug
          <input
            aria-label="Project slug"
            className={`mt-1.5 font-mono font-normal ${glassInput}`}
            value={effectiveSlug}
            placeholder="my-client"
            onChange={(e) => {
              setSlugEdited(true);
              setSlug(e.target.value);
            }}
            required
          />
          <span className="mt-1 font-normal text-[11px] text-slate-400">The site’s URL-safe identifier — auto-filled from the name.</span>
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {/* Submit via the header ✓ (Create project) or Enter; a hidden submit input wires Enter. */}
        <input type="submit" hidden />
      </form>
    </Modal>
  );
}
