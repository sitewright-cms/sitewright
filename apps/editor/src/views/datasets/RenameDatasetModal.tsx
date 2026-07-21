import { useRef, useState } from 'react';
import type { Dataset, Entry } from '@sitewright/schema';
import { api } from '../../api';
import { glassInput } from '../../theme';
import { Modal } from '../ui/Modal';
import { useDialogs } from '../ui/Dialogs';

interface RenameDatasetModalProps {
  projectId: string;
  dataset: Dataset;
  /** The dataset's entries — only used to show how many a cascade will re-point. */
  entries: Entry[];
  /** Every OTHER dataset's slug in the project, to reject a colliding slug client-side. */
  existingSlugs: ReadonlySet<string>;
  /** Called after a successful rename — the dataset id is unchanged, so the caller reselects by id. */
  onRenamed: () => void | Promise<void>;
  onClose: () => void;
}

// The slug allow-list (mirrors the server's DatasetSlugSchema): a dataset slug is a Handlebars/JS
// identifier used directly as `dataset.<slug>`, so lowercase letters/digits in UNDERSCORE-separated
// groups — no hyphens (they'd parse as subtraction), spaces, symbols, or leading/trailing/double `_`.
const SLUG_RE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

/**
 * Rename a dataset's display NAME and/or its SLUG (the binding key). The name is cosmetic. Changing the
 * slug is a server-side, ATOMIC operation (`api.renameDataset`) that CASCADES — every entry's `dataset`
 * field and every page/template `{{#each dataset.<slug>}}` / `dataset="<slug>"` reference is rewritten so
 * nothing breaks. The slug is allow-list validated (lowercase identifier with underscores). On a slug
 * change the user picks: Cancel (close) · Rename + update references (cascade) · Rename only (leave refs).
 */
export function RenameDatasetModal({ projectId, dataset, entries, existingSlugs, onRenamed, onClose }: RenameDatasetModalProps) {
  const { confirm, dialog } = useDialogs();
  const [name, setName] = useState(dataset.name);
  const [slugInput, setSlugInput] = useState(dataset.slug);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);

  const slug = slugInput.trim().toLowerCase();
  const slugChanged = slug !== dataset.slug;
  const slugValid = SLUG_RE.test(slug);
  const slugTaken = slugChanged && existingSlugs.has(slug);
  const trimmedName = name.trim();
  const nameInvalid = trimmedName === '';
  const nameChanged = trimmedName !== dataset.name;
  const dirty = nameChanged || slugChanged;
  const blocked = nameInvalid || (slugChanged && (!slugValid || slugTaken));

  async function run(cascade: boolean) {
    if (submitting.current || blocked) return;
    submitting.current = true;
    setSaving(true);
    setError(null);
    try {
      if (nameChanged) await api.putDataset(projectId, { ...dataset, name: trimmedName }); // cosmetic; keeps old slug
      if (slugChanged) await api.renameDataset(projectId, dataset.id, slug, cascade);
      await onRenamed();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to rename dataset');
    } finally {
      setSaving(false);
      submitting.current = false;
    }
  }

  async function confirmClose(): Promise<boolean> {
    if (!dirty) return true;
    return confirm({ title: 'Discard changes', message: 'Discard the rename?', confirmLabel: 'Discard' });
  }

  const entryCount = entries.length;
  return (
    <Modal
      title={`Rename ${dataset.name}`}
      size="md"
      onClose={onClose}
      onBeforeClose={confirmClose}
      // No slug change → the Save button just updates the name. A slug change is committed via the explicit
      // choice buttons below (so the cascade decision is deliberate), so the header Save is hidden then.
      onSave={slugChanged ? undefined : () => void run(false)}
      saving={saving}
      saveDisabled={!dirty || nameInvalid}
      saveLabel="Save"
    >
      <div className="flex flex-col gap-3 p-5">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Name</span>
          <input aria-label="Dataset name" className={glassInput} value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Slug <span className="text-slate-400 dark:text-slate-500">— the binding key in <code>{`{{#each dataset.<slug>}}`}</code></span>
          </span>
          <input
            aria-label="Dataset slug"
            className={glassInput}
            value={slugInput}
            onChange={(e) => setSlugInput(e.target.value)}
            placeholder={dataset.slug}
          />
          <span className={`text-[11px] ${slugChanged && (!slugValid || slugTaken) ? 'text-rose-500 dark:text-rose-300' : 'text-slate-400 dark:text-slate-500'}`}>
            {slugChanged && !slugValid
              ? 'Use only lowercase letters, numbers, and underscores, e.g. faq_passengers (no hyphens — they break the binding).'
              : slugTaken
                ? `“${slug}” is already used by another dataset.`
                : 'Lowercase letters, numbers, and underscores only (e.g. faq_passengers).'}
          </span>
        </label>

        {slugChanged && slugValid && !slugTaken && (
          <div className="flex flex-col gap-2 rounded-lg bg-amber-50 dark:bg-amber-500/10 px-3 py-3 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
            <p>
              Renaming the slug to <code>{slug}</code> changes the binding key. Choose how to handle the{' '}
              {entryCount} {entryCount === 1 ? 'entry' : 'entries'} and any page/template references:
            </p>
            <button
              type="button"
              disabled={saving}
              onClick={() => void run(true)}
              className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
            >
              Rename + update all references (recommended)
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void run(false)}
              className="rounded-md border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-500/15 disabled:opacity-60"
            >
              Rename slug only — leave references (advanced; loops will break until you fix them)
            </button>
          </div>
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>
      {dialog}
    </Modal>
  );
}
