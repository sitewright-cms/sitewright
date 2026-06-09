import { SidePanel } from '../ui/SidePanel';
import { DatasetManager } from '../DatasetManager';
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
 */
export function DataPanel({ project }: { project: Project }) {
  return (
    <SidePanel side="bottom" align="start" label="Datasets" icon={<DataIcon />} width="w-[min(56rem,66vw)]">
      <div className="p-1">
        <DatasetManager project={project} />
      </div>
    </SidePanel>
  );
}
