import type { Project } from '../api';
import { Modal } from './ui/Modal';
import { InstanceSettings } from './InstanceSettings';
import { ClientsManager } from './ClientsManager';
import { TeamManager } from './TeamManager';
import { ApiKeysManager } from './ApiKeysManager';

/** The settings surfaces opened (as modals) from the header gear menu. */
export type SettingsView = 'system' | 'clients' | 'team' | 'access';

/**
 * Renders the active header-settings surface AS A MODAL. System Settings is global (no project);
 * Clients / Team / Access are project-scoped. Each view carries its own actions/save — these modals
 * supply only the chrome (title + close). Publish & Deploy lives in its own PublishDeployModal.
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
  return (
    <Modal title="Access" size="lg" onClose={onClose}>
      <div className="p-5">
        {/* Keyed so the one-time-token banner + state reset if the project changes while open. */}
        <ApiKeysManager key={project.id} project={project} />
      </div>
    </Modal>
  );
}
