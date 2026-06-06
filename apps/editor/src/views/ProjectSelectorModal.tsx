import { useMemo, useState } from 'react';
import type { Project } from '../api';
import { Modal } from './ui/Modal';
import { glassCard, glassInput, primaryButton } from '../theme';

interface ProjectSelectorModalProps {
  projects: Project[];
  /** The currently-open project (highlighted), if any. */
  currentId?: string;
  onClose: () => void;
  onOpen: (project: Project) => void;
  /** Open the New Project modal (the selector closes first). */
  onNew: () => void;
}

/**
 * The project picker, in a modal: a searchable list of the user's projects plus a
 * NEW PROJECT button. Shown automatically on first load and reachable anytime by
 * clicking the project name in the header.
 */
export function ProjectSelectorModal({ projects, currentId, onClose, onOpen, onNew }: ProjectSelectorModalProps) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q));
  }, [projects, query]);

  return (
    <Modal
      title="Your projects"
      size="md"
      onClose={onClose}
      headerExtra={
        <button type="button" className={`${primaryButton} px-3 py-1.5 text-xs`} onClick={onNew}>
          New project
        </button>
      }
    >
      <div className="flex flex-col gap-3 p-5">
        <input
          aria-label="Search projects"
          className={glassInput}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search projects…"
          autoFocus
        />
        <ul className="flex max-h-[55vh] flex-col gap-2 overflow-auto">
          {filtered.map((p) => (
            <li key={p.id}>
              <button
                className={`w-full ${glassCard} px-4 py-3 text-left transition hover:bg-white/80 ${p.id === currentId ? 'ring-2 ring-indigo-400' : ''}`}
                onClick={() => onOpen(p)}
              >
                <span className="font-medium">{p.name}</span> <span className="text-sm text-slate-400">/{p.slug}</span>
                {p.role === 'member' && <span className="ml-2 rounded-full bg-indigo-100/80 px-2 py-0.5 text-[11px] font-medium text-indigo-700">client</span>}
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="py-2 text-sm text-slate-400">{query ? 'No projects match your search.' : 'No projects yet — create your first one.'}</li>
          )}
        </ul>
      </div>
    </Modal>
  );
}
