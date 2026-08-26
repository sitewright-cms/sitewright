import { useCallback, useState } from 'react';
import { SidePanel } from '../ui/SidePanel';
import { FileBrowser, formatBytes } from './FileBrowser';

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
 *
 * The title bar carries the LIBRARY TOTAL (file count + bytes on disk) reported by the browser — the
 * whole project, not the open folder, so it answers "how big is this site's media?" from anywhere in
 * the tree. Media is the dominant term in a project's footprint and the number was previously
 * reachable only by adding up folders by hand.
 *
 * ON MOBILE it moves off the right EDGE and docks into the BOTTOM-RIGHT CORNER instead — one of the
 * only two rails a phone keeps (App.tsx explains which and why). Two reasons it has to move rather
 * than just stay: a 26rem side rail is wider than the phone it would slide over, and clearing both
 * screen sides is the whole point of the mobile rail cull. Note `size` is axis-dependent in
 * {@link SidePanel} — a width class on a side rail, a HEIGHT class on a bottom one — so the panel's
 * width moves to the separate `width` prop when it docks to the bottom.
 */
export function AssetsPanel({ projectId, openSignal, mobile }: { projectId: string; openSignal?: number; mobile?: boolean }) {
  const [totals, setTotals] = useState<{ count: number; bytes: number } | null>(null);
  // Identity-stable so the browser's report effect doesn't re-fire on every parent render.
  const onTotals = useCallback((t: { count: number; bytes: number }) => setTotals(t), []);
  return (
    <SidePanel
      side={mobile ? 'bottom' : 'right'}
      align={mobile ? 'end' : undefined}
      label="File Manager"
      icon={<FilesIcon />}
      headerExtra={
        totals && (
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {totals.count} {totals.count === 1 ? 'file' : 'files'} · {formatBytes(totals.bytes)}
          </span>
        )
      }
      // Bottom: nearly the whole viewport, matching the Datasets rail — a file grid needs the room,
      // and on a phone there is nothing behind it worth keeping visible.
      size={mobile ? 'h-[100dvh]' : 'w-[min(56rem,94vw)]'}
      width={mobile ? 'w-[min(56rem,100vw)]' : undefined}
      openSignal={openSignal}
      openOnFileDrag
    >
      <div className="p-4">
        <FileBrowser projectId={projectId} mode="manage" onTotals={onTotals} />
      </div>
    </SidePanel>
  );
}
