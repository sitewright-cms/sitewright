import { useMemo, useState } from 'react';
import { Globe } from 'lucide-react';
import type { Project, Branding } from '../api';
import { Modal } from './ui/Modal';
import { BrandLogo } from './ui/BrandLogo';
import { SearchField } from './ui/SearchField';
import { DEFAULT_BRANDING } from '../lib/use-branding';
import { glassCard, primaryButton, gradientSurface, gradientHover } from '../theme';

/** A project's favicon (from `identity.icon`), falling back to a placeholder globe when unset or broken. */
function ProjectIcon({ src, active }: { src?: string; active: boolean }) {
  const [broken, setBroken] = useState(false);
  const box = `flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg ${
    active ? 'bg-white/20' : 'bg-slate-100 dark:bg-slate-700/60'
  }`;
  if (src && !broken) {
    return (
      <span className={box}>
        {/* no-referrer: an owner-set external favicon URL must not receive a Referer beacon (belt-and-
            suspenders over the global same-origin referrer-policy header). */}
        <img src={src} alt="" className="h-full w-full object-contain" onError={() => setBroken(true)} loading="lazy" referrerPolicy="no-referrer" />
      </span>
    );
  }
  return (
    <span className={box} aria-hidden>
      <Globe className={`h-4 w-4 ${active ? 'text-white/80' : 'text-slate-400 dark:text-slate-500'}`} />
    </span>
  );
}

/** Strip the scheme + trailing slash from a URL for a compact display (e.g. `https://acme.com/` → `acme.com`). */
function prettyUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

interface ProjectSelectorModalProps {
  projects: Project[];
  /** The currently-open project (highlighted), if any. */
  currentId?: string;
  /** The admin-panel branding (name + logo) for the modal header; defaults to the built-in brand. */
  branding?: Branding;
  onClose: () => void;
  onOpen: (project: Project) => void;
  /** Whether the user may create projects (agency staff only) — hides the New/From-website buttons. */
  canCreate?: boolean;
  /** Open the New Project modal (the selector closes first). */
  onNew: () => void;
  /** Import a project export zip as a brand-new project (the selector closes first). */
  onImportZip: () => void;
}

/**
 * The project picker, in a modal: a searchable list of the user's projects plus a
 * NEW PROJECT button. Shown automatically on first load and reachable anytime by
 * clicking the project name in the header.
 */
export function ProjectSelectorModal({ projects, currentId, branding = DEFAULT_BRANDING, canCreate = false, onClose, onOpen, onNew, onImportZip }: ProjectSelectorModalProps) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? projects.filter((p) => p.name.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q) || (p.siteUrl ?? '').toLowerCase().includes(q))
      : projects;
    // Alphabetical by name (case/locale-insensitive), stable — the list is a flat A→Z picker.
    return [...matched].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }, [projects, query]);

  return (
    <Modal
      title={branding.name}
      size="lg"
      onClose={onClose}
      headerLeft={<BrandLogo logoUrl={branding.logoUrl} name={branding.name} className="h-6 w-6 text-slate-900 dark:text-slate-100" />}
      headerExtra={
        // Creating projects is an agency-staff action; clients only ever pick from their invited projects.
        canCreate ? (
          <div className="flex gap-2">
            <button type="button" className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 transition hover:border-slate-300 dark:hover:border-slate-600 hover:text-slate-900 dark:hover:text-slate-100" onClick={onImportZip}>
              Import zip
            </button>
            <button type="button" className={`${primaryButton} px-3 py-1.5 text-xs`} onClick={onNew}>
              New project
            </button>
          </div>
        ) : undefined
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
          {filtered.map((p) => {
            const active = p.id === currentId;
            const subtitle = p.siteUrl ? prettyUrl(p.siteUrl) : `/${p.slug}`;
            return (
              <li key={p.id}>
                <button
                  className={`group flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition ${
                    active ? gradientSurface : `${glassCard} ${gradientHover}`
                  }`}
                  onClick={() => onOpen(p)}
                >
                  <ProjectIcon src={p.iconUrl} active={active} />
                  <span className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">{p.name}</span>
                      {p.role === 'member' && (
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            active
                              ? 'bg-white/20 text-white'
                              : 'bg-indigo-100/80 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 group-hover:bg-white/20 group-hover:text-white'
                          }`}
                        >
                          member
                        </span>
                      )}
                    </span>
                    <span className={`truncate text-sm ${active ? 'text-white/80' : 'text-slate-400 dark:text-slate-500 group-hover:text-white/80'}`}>
                      {subtitle}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
          {filtered.length === 0 && (
            <li className="py-2 text-sm text-slate-400 dark:text-slate-500">
              {query ? 'No projects match your search.' : canCreate ? 'No projects yet — create your first one.' : 'No projects yet.'}
            </li>
          )}
        </ul>
      </div>
    </Modal>
  );
}
