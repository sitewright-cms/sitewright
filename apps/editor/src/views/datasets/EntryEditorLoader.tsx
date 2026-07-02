import { useEffect, useState } from 'react';
import type { Dataset, Entry } from '@sitewright/schema';
import { api } from '../../api';
import { EntryEditorModal } from './EntryEditorModal';

interface EntryEditorLoaderProps {
  projectId: string;
  /** The dataset slug carried by the clicked `data-sw-entry` marker (may be a `<slug>-<locale>` variant). */
  dataset: string;
  id: string;
  onSaved: () => void;
  onClose: () => void;
}

/**
 * Loads the dataset schema + the one entry for a preview-clicked `data-sw-entry`, then renders the
 * {@link EntryEditorModal} for it (stacked over the page editor). If the entry/dataset no longer
 * exists (deleted since render), it just closes.
 */
export function EntryEditorLoader({ projectId, dataset, id, onSaved, onClose }: EntryEditorLoaderProps) {
  const [found, setFound] = useState<{ dataset: Dataset; entry: Entry } | null>(null);
  useEffect(() => {
    let alive = true;
    // `dataset` is the SLUG carried by data-sw-dataset, which is NOT the dataset's entity id once the
    // dataset has been renamed (rename_dataset changes the slug but keeps the id) — so resolve it by SLUG
    // from the dataset list, not by id (getDataset(slug) 404s for a renamed dataset). Fall back to an id
    // match for safety. The entry is fetched by (dataset slug + id) — its id is only unique per-dataset;
    // a stale marker slug (pre-rename) 404s here and just closes, same as the dataset-resolve miss below.
    void Promise.all([api.listDatasets(projectId), api.getEntry(projectId, id, dataset)])
      .then(([ds, e]) => {
        if (!alive) return;
        const d = ds.items.find((x) => x.slug === dataset) ?? ds.items.find((x) => x.id === dataset);
        if (d && e.item && e.item.dataset === d.slug) setFound({ dataset: d, entry: e.item });
        else onClose();
      })
      .catch(() => alive && onClose()); // 404 (deleted) or load error → just close
    return () => {
      alive = false;
    };
    // onClose is intentionally excluded — it changes identity each render and would refetch in a loop.
  }, [projectId, dataset, id]);

  if (!found) return null;
  return <EntryEditorModal projectId={projectId} dataset={found.dataset} entry={found.entry} onSaved={onSaved} onClose={onClose} />;
}
