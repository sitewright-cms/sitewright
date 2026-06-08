import { useMemo, useState } from 'react';
import type { Project } from '../api';
import { Modal } from './ui/Modal';
import { BrandMark } from './ui/BrandMark';
import { glassCard, glassInput, primaryButton, gradientSurface, gradientHover } from '../theme';

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
      title="SiteWright"
      size="md"
      onClose={onClose}
      headerLeft={<BrandMark className="h-6 w-6 text-slate-900" />}
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
                className={`group w-full rounded-2xl px-4 py-3 text-left transition ${
                  p.id === currentId ? gradientSurface : `${glassCard} ${gradientHover}`
                }`}
                onClick={() => onOpen(p)}
              >
                <span className="font-medium">{p.name}</span>{' '}
                <span className={`text-sm ${p.id === currentId ? 'text-white/80' : 'text-slate-400 group-hover:text-white/80'}`}>
                  /{p.slug}
                </span>
                {p.role === 'member' && (
                  <span
                    className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      p.id === currentId
                        ? 'bg-white/20 text-white'
                        : 'bg-indigo-100/80 text-indigo-700 group-hover:bg-white/20 group-hover:text-white'
                    }`}
                  >
                    client
                  </span>
                )}
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
