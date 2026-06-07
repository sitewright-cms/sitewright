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
 * The project's Assets manager as a RIGHT-edge {@link SidePanel} (replaces the old slide-in drawer):
 * full file/folder CRUD via the shared {@link FileBrowser}. Always reachable from its edge tab; the
 * header "Assets" button force-opens it by bumping `openSignal`. The browser's own dialogs (preview,
 * rename, delete) render inside the panel, so they elevate above it.
 */
export function AssetsPanel({ projectId, openSignal }: { projectId: string; openSignal?: number }) {
  return (
    <SidePanel side="right" label="Assets" icon={<FilesIcon />} size="w-[30rem]" openSignal={openSignal}>
      <div className="p-3">
        <FileBrowser projectId={projectId} mode="manage" />
      </div>
    </SidePanel>
  );
}
