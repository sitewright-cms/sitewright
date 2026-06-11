import { useRef, useState } from 'react';
import type { Dataset, Entry } from '@sitewright/schema';
import { slugify } from '../../lib/entry-form';
import { api } from '../../api';
import { glassInput } from '../../theme';
import { Modal } from '../ui/Modal';
import { useDialogs } from '../ui/Dialogs';

interface RenameDatasetModalProps {
  projectId: string;
  dataset: Dataset;
  /** The dataset's entries — re-pointed to the new slug on a slug change (ids preserved). */
  entries: Entry[];
  /** Every dataset id/slug in the project, to reject a colliding slug. */
  existingSlugs: ReadonlySet<string>;
  /** Called after a successful rename with the (possibly new) slug to select. */
  onRenamed: (slug: string) => void;
  onClose: () => void;
}

/**
 * Rename a dataset's display NAME and/or its SLUG (the binding key). The name is cosmetic; changing
 * the slug is a MIGRATION — there is no atomic server rename, so we create the dataset under the new
 * slug, re-point every entry to it (entry ids are preserved), then delete the old dataset row
 * (deleting a dataset does NOT cascade to entries, so this is loss-free at every step). Page-source
 * references ({{#each data.<slug>}} / {{item.<slug>…}}) cannot be auto-rewritten — the modal warns
 * that they must be updated by hand.
 */
export function RenameDatasetModal({ projectId, dataset, entries, existingSlugs, onRenamed, onClose }: RenameDatasetModalProps) {
  const { confirm, dialog } = useDialogs();
  const [name, setName] = useState(dataset.name);
  const [slugInput, setSlugInput] = useState(dataset.slug);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false); // synchronous re-entry guard (Cmd+S can fire before `saving` flushes)

  const computedSlug = slugify(slugInput);
  const slugChanged = computedSlug !== dataset.slug;
  const slugInvalid = computedSlug === '';
  // existingSlugs includes this dataset's own slug, so exclude self via slugChanged.
  const slugTaken = slugChanged && existingSlugs.has(computedSlug);
  const trimmedName = name.trim();
  const nameInvalid = trimmedName === '';
  const nameChanged = trimmedName !== dataset.name;
  const dirty = nameChanged || slugChanged;

  async function submit() {
    if (submitting.current) return; // a migration is already in flight (don't double-delete the old row)
    if (nameInvalid) {
      setError('Name cannot be empty.');
      return;
    }
    if (slugInvalid) {
      setError('Slug must contain letters or numbers.');
      return;
    }
    if (slugTaken) {
      setError(`A dataset with the slug “${computedSlug}” already exists.`);
      return;
    }
    submitting.current = true;
    setSaving(true);
    setError(null);
    try {
      if (!slugChanged) {
        // Name-only: update the dataset row in place (id/slug unchanged).
        await api.putDataset(projectId, { ...dataset, name: trimmedName });
      } else {
        // Slug migration: create-new → re-point entries (same ids) → delete-old. Re-fetch the
        // authoritative entry list first so a concurrently-added entry isn't stranded on the old
        // slug after the old dataset row is deleted (deleting a dataset does NOT cascade).
        const live = (await api.listEntries(projectId)).items.filter((e) => e.dataset === dataset.slug);
        await api.putDataset(projectId, {
          id: computedSlug,
          name: trimmedName,
          slug: computedSlug,
          fields: dataset.fields.map((f) => ({ ...f })),
        });
        // If any re-point rejects, Promise.all rejects and the old dataset is NOT deleted — the
        // entries are never lost (worst case: a retriable split between the two slugs).
        await Promise.all(live.map((e) => api.putEntry(projectId, { ...e, dataset: computedSlug })));
        await api.deleteDataset(projectId, dataset.id);
      }
      onRenamed(slugChanged ? computedSlug : dataset.id);
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

  return (
    <Modal
      title={`Rename ${dataset.name}`}
      size="md"
      onClose={onClose}
      onBeforeClose={confirmClose}
      onSave={() => void submit()}
      saving={saving}
      saveDisabled={!dirty || nameInvalid || slugInvalid || slugTaken}
    >
      <div className="flex flex-col gap-3 p-5">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">Name</span>
          <input aria-label="Dataset name" className={glassInput} value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">
            Slug <span className="text-slate-300">— the binding key used in <code>{`{{#each data.<slug>}}`}</code></span>
          </span>
          <input
            aria-label="Dataset slug"
            className={glassInput}
            value={slugInput}
            onChange={(e) => setSlugInput(e.target.value)}
            placeholder={dataset.slug}
          />
          <span className={`text-[11px] ${slugTaken || slugInvalid ? 'text-rose-500' : 'text-slate-400'}`}>
            {slugInvalid ? (
              'enter lowercase letters, digits, or hyphens'
            ) : (
              <>→ <code>{computedSlug}</code>{slugTaken ? ' · already used by another dataset' : ''}</>
            )}
          </span>
        </label>

        {slugChanged && !slugInvalid && (
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700">
            Changing the slug re-points all {entries.length} {entries.length === 1 ? 'entry' : 'entries'} to{' '}
            <code>{computedSlug}</code> and changes the binding key. Page code is <strong>not</strong> updated
            automatically — update every reference:
            <ul className="ml-4 mt-1 list-disc">
              <li>
                <code>{`{{#each data.${dataset.slug}}}`}</code> → <code>{`{{#each data.${computedSlug}}}`}</code>
              </li>
              <li>
                <code>{`{{item.${dataset.slug}.…}}`}</code> → <code>{`{{item.${computedSlug}.…}}`}</code>
              </li>
            </ul>
            Localized variants (<code>{dataset.slug}-&lt;locale&gt;</code>) are separate datasets and are not renamed.
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
      {dialog}
    </Modal>
  );
}
