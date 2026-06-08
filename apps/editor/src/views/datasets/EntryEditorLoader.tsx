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
    // Targeted fetch of the one dataset (id === slug) + the one entry — not the whole project.
    void Promise.all([api.getDataset(projectId, dataset), api.getEntry(projectId, id)])
      .then(([d, e]) => {
        if (!alive) return;
        if (d.item && e.item && e.item.dataset === dataset) setFound({ dataset: d.item, entry: e.item });
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
