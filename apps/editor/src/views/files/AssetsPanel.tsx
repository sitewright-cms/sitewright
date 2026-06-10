import { SidePanel } from '../ui/SidePanel';
import { FileBrowser } from './FileBrowser';

/** Files glyph (open folder) for the side-panel tab. */
function FilesIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

/**
 * The project's File Manager as a RIGHT-edge {@link SidePanel} (replaces the old slide-in drawer):
 * full file/folder CRUD via the shared {@link FileBrowser}. Reachable from its edge tab — or by
 * dragging OS files onto that tab (`openOnFileDrag`), which opens the panel so the drop lands on the
 * browser's drop zone (unreachable while collapsed). The browser's own dialogs (preview, rename,
 * delete) render inside the panel, so they elevate above it.
 */
export function AssetsPanel({ projectId, openSignal }: { projectId: string; openSignal?: number }) {
  return (
    <SidePanel side="right" label="File Manager" icon={<FilesIcon />} size="w-[min(44rem,92vw)]" openSignal={openSignal} openOnFileDrag>
      <div className="p-4">
        <FileBrowser projectId={projectId} mode="manage" />
      </div>
    </SidePanel>
  );
}
