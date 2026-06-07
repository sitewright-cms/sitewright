import { Drawer } from '../ui/Drawer';
import { FileBrowser } from './FileBrowser';

/**
 * The project's Assets manager as a right-side drawer (replaces the old Assets tab/page). Full
 * file/folder CRUD via the shared {@link FileBrowser}. Opened from the project toolbar; a field's
 * FilePicker can also deep-link here for full management.
 */
export function FileManager({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  return (
    <Drawer title="Assets" width="xl" onClose={onClose}>
      <FileBrowser projectId={projectId} mode="manage" />
    </Drawer>
  );
}
