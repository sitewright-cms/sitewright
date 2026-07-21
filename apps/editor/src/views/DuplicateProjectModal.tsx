import { useState } from 'react';
import { Copy, Loader2 } from 'lucide-react';
import { Modal } from './ui/Modal';
import { api, type Project } from '../api';
import { ghostButton, primaryButton } from '../theme';

interface DuplicateProjectModalProps {
  project: Project;
  onClose: () => void;
  /** Called after a successful duplicate with the freshly-created copy (navigate to it). */
  onDuplicated: (copy: Project) => void;
}

/**
 * Confirm + run an in-instance project DUPLICATE. Server-side it assembles the source's export
 * bundle, mints a new project, imports the content and copies the media tree — non-destructive to
 * the original. Staff-only (the gear item is only shown to agency staff).
 */
export function DuplicateProjectModal({ project, onClose, onDuplicated }: DuplicateProjectModalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { project: copy } = await api.duplicateProject(project.id);
      onDuplicated(copy);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not duplicate the project.');
      setBusy(false);
    }
  };

  return (
    <Modal title="Duplicate project" onClose={onClose} size="md">
      <div className="space-y-4 p-1">
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-white/5 p-3 text-sm text-slate-700 dark:text-slate-200">
          <p className="font-semibold">Create an independent copy of “{project.name}”.</p>
          <p className="mt-1.5">
            The copy gets its own slug and all of the pages, content, datasets and media. Deploy
            targets and SMTP credentials are not copied. The original is untouched.
          </p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={ghostButton} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run()}
            className={`${primaryButton} inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
            {busy ? 'Duplicating…' : 'Duplicate'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
