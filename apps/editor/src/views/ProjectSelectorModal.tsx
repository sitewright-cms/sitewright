import { useMemo, useState } from 'react';
import type { Project, Branding } from '../api';
import { Modal } from './ui/Modal';
import { BrandLogo } from './ui/BrandLogo';
import { SearchField } from './ui/SearchField';
import { DEFAULT_BRANDING } from '../lib/use-branding';
import { glassCard, primaryButton, gradientSurface, gradientHover } from '../theme';

interface ProjectSelectorModalProps {
  projects: Project[];
  /** The currently-open project (highlighted), if any. */
  currentId?: string;
  /** The admin-panel branding (name + logo) for the modal header; defaults to the built-in brand. */
  branding?: Branding;
  onClose: () => void;
  onOpen: (project: Project) => void;
  /** Open the New Project modal (the selector closes first). */
  onNew: () => void;
  /** Create a new project then open the import wizard against it (the selector closes first). */
  onNewFromWebsite: () => void;
}

/**
 * The project picker, in a modal: a searchable list of the user's projects plus a
 * NEW PROJECT button. Shown automatically on first load and reachable anytime by
 * clicking the project name in the header.
 */
export function ProjectSelectorModal({ projects, currentId, branding = DEFAULT_BRANDING, onClose, onOpen, onNew, onNewFromWebsite }: ProjectSelectorModalProps) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q));
  }, [projects, query]);

  return (
    <Modal
      title={branding.name}
      size="md"
      onClose={onClose}
      headerLeft={<BrandLogo logoUrl={branding.logoUrl} name={branding.name} className="h-6 w-6 text-slate-900" />}
      headerExtra={
        <div className="flex gap-2">
          <button type="button" className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900" onClick={onNewFromWebsite}>
            From website
          </button>
          <button type="button" className={`${primaryButton} px-3 py-1.5 text-xs`} onClick={onNew}>
            New project
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 p-5">
        <SearchField
          ariaLabel="Search projects"
          value={query}
          onChange={setQuery}
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
