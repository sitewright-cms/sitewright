import type { Project } from '../api';
import { Modal } from './ui/Modal';
import { InstanceSettings } from './InstanceSettings';
import { ClientsManager } from './ClientsManager';
import { TeamManager } from './TeamManager';

/** The settings surfaces opened (as modals) from the header gear menu. */
export type SettingsView = 'system' | 'clients' | 'team';

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
      <Modal title="System settings" size="xl" onClose={onClose}>
        <InstanceSettings />
      </Modal>
    );
  }
  // The remaining surfaces are project-scoped — only reachable with a project open.
  if (!project) return null;
  if (view === 'clients') {
    return (
      <Modal title="Clients" size="lg" onClose={onClose}>
        <div className="p-5">
          {/* Keyed so the data + state reset if the project changes while open. */}
          <ClientsManager key={project.id} project={project} />
        </div>
      </Modal>
    );
  }
  if (view === 'team') {
    return (
      <Modal title="Team" size="lg" onClose={onClose}>
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
