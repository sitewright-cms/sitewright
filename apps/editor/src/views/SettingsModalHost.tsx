import { useEffect, useState } from 'react';
import { api, type Project } from '../api';
import { Modal } from './ui/Modal';
import { InstanceSettings } from './InstanceSettings';
import { ClientsManager } from './ClientsManager';
import { TeamManager } from './TeamManager';

/** The settings surfaces opened (as modals) from the header gear menu. */
export type SettingsView = 'system' | 'clients' | 'team';

/**
 * The deployed instance version, shown in the System Settings header. Reads `GET /version`
 * (`current` = the image's baked SW_VERSION, reported by the api). When a newer release exists it
 * becomes a subtle link to the release notes; otherwise a plain version badge. Best-effort — renders
 * nothing until (and unless) the version resolves.
 */
function VersionBadge() {
  const [info, setInfo] = useState<{ current: string; updateAvailable: boolean; releaseUrl: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .version()
      .then((r) => alive && setInfo({ current: r.current, updateAvailable: r.updateAvailable, releaseUrl: r.releaseUrl }))
      .catch(() => {
        /* version is best-effort — the header just omits the badge if it can't be read */
      });
    return () => {
      alive = false;
    };
  }, []);
  if (!info) return null;
  const badge = (
    <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
      v{info.current}
    </span>
  );
  if (info.updateAvailable && info.releaseUrl) {
    return (
      <a
        href={info.releaseUrl}
        target="_blank"
        rel="noopener noreferrer"
        title="A newer version is available — view the release notes"
        className="inline-flex items-center gap-1.5 text-xs text-amber-600 transition hover:text-amber-700 dark:text-amber-400"
      >
        {badge}
        <span className="font-medium">update available</span>
      </a>
    );
  }
  return badge;
}

/**
 * Renders the active header-settings surface AS A MODAL. System Settings is global (no project);
 * Clients / Team are project-scoped. Each view carries its own actions/save — these modals supply
 * only the chrome (title + close). Publish & Deploy lives in its own PublishDeployModal; access keys
 * moved to the user/account menu (UserMenu).
 */
export function SettingsModalHost({
  view,
  project,
  onClose,
}: {
  view: SettingsView;
  project: Project | null;
  onClose: () => void;
}) {
  if (view === 'system') {
    // The instance/system settings form brings its own padding + Save button.
    return (
      <Modal title="System settings" titleExtra={<VersionBadge />} size="2xl" onClose={onClose}>
        <InstanceSettings />
      </Modal>
    );
  }
  // The remaining surfaces are project-scoped — only reachable with a project open.
  if (!project) return null;
  if (view === 'clients') {
    return (
      <Modal title="Project Members" size="lg" onClose={onClose}>
        <div className="p-5">
          {/* Keyed so the data + state reset if the project changes while open. */}
          <ClientsManager key={project.id} project={project} />
        </div>
      </Modal>
    );
  }
  if (view === 'team') {
    return (
      <Modal title="Administrators" size="lg" onClose={onClose}>
        <div className="p-5">
          <TeamManager />
        </div>
      </Modal>
    );
  }
  // Exhaustiveness guard: adding a SettingsView variant without a branch becomes a compile error
  // rather than silently rendering nothing.
  const _exhaustive: never = view;
  return _exhaustive;
}
