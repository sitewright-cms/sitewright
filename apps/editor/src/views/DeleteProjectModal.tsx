import { useState } from 'react';
import { Modal } from './ui/Modal';
import { api, type Project } from '../api';
import { ghostButton, glassInput } from '../theme';

interface DeleteProjectModalProps {
  project: Project;
  onClose: () => void;
  /** Called after a successful soft-delete (the caller leaves the now-deleted project). */
  onDeleted: () => void;
}

/**
 * GitHub-style "type the name to confirm" deletion of the whole project. The action is a recoverable
 * SOFT-delete: the project is hidden + its published site goes offline, but an administrator can
 * restore it (or permanently reap it) from System Settings. The red button arms only when the typed
 * text matches the project name exactly.
 */
export function DeleteProjectModal({ project, onClose, onDeleted }: DeleteProjectModalProps) {
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const armed = confirm.trim() === project.name.trim() && !busy;

  const del = async () => {
    if (confirm.trim() !== project.name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteProject(project.id);
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the project.');
      setBusy(false);
    }
  };

  return (
    <Modal title="Delete project" onClose={onClose} size="md">
      <div className="space-y-4 p-1">
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <p className="font-semibold">This deletes the entire “{project.name}” project.</p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-rose-700">
            <li>Its pages, content, datasets, media and deploy targets</li>
            <li>Its invited project members’ access (your agency staff are unaffected)</li>
            <li>Its published site goes offline immediately</li>
          </ul>
          <p className="mt-2">
            It becomes a <strong>deleted project</strong> an administrator can <strong>restore</strong> — or
            permanently remove, which finally erases all of the above from the database and disk.
          </p>
        </div>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">
            Type <span className="rounded bg-slate-100 px-1 font-mono text-slate-900">{project.name}</span> to confirm
          </span>
          <input
            autoFocus
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void del();
            }}
            className={`${glassInput} mt-1`}
            aria-label="Type the project name to confirm deletion"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-rose-600">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={ghostButton}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!armed}
            onClick={() => void del()}
            className="waves-effect inline-flex items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-1.5 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Deleting…' : 'Delete project'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
