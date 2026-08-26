import { useEffect, useState } from 'react';
import { SidePanel } from '../ui/SidePanel';
import { DatasetManager } from '../DatasetManager';
import { onDatasetViewRequest } from '../../lib/dataset-navigation';
import type { Project } from '../../api';

/** Database glyph for the Data rail tab. */
function DataIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
      <path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
    </svg>
  );
}

/**
 * The project's datasets/entries CMS as a bottom-LEFT {@link SidePanel} (it left the top tablist).
 * Wider than the code rails — the {@link DatasetManager} has a list + editor two-column layout.
 *
 * Already in the corner mobile wants it in, so `mobile` only widens it: 66vw of a phone is ~250px,
 * too narrow for a form, where 66vw of a monitor is the deliberate "does not swallow the screen"
 * size. Editing copy through a dataset form is the main reason to open the editor on a phone at all
 * (App.tsx's rail block), so it takes the full width there.
 */
export function DataPanel({ project, mobile }: { project: Project; mobile?: boolean }) {
  // "View dataset" from an entry opened over the page editor: force the rail open and select the one
  // asked for. The counter is what SidePanel takes — a boolean could not re-open the panel after the
  // reader closed it and clicked through a second time.
  const [openSignal, setOpenSignal] = useState(0);
  const [selectSlug, setSelectSlug] = useState<string | null>(null);
  useEffect(
    () =>
      onDatasetViewRequest((slug) => {
        setSelectSlug(slug);
        setOpenSignal((n) => n + 1);
      }),
    [],
  );

  return (
    <SidePanel
      side="bottom"
      align="start"
      label="Datasets"
      icon={<DataIcon />}
      width={mobile ? 'w-[min(56rem,100vw)]' : 'w-[min(56rem,66vw)]'}
      size="h-[100dvh]"
      openSignal={openSignal}
    >
      <div className="p-1">
        <DatasetManager project={project} selectSlug={selectSlug} selectSignal={openSignal} />
      </div>
    </SidePanel>
  );
}
