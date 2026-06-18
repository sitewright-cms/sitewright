import { type Project } from '../../api';
import { Modal } from '../ui/Modal';
import { DeployForm } from './DeployForm';

/**
 * The deploy-targets modal (opened from the header). Local hosting + external servers are now both
 * DEPLOY TARGETS (the old "Local Publish" website options moved onto the `local` target), managed here
 * via {@link DeployForm}. `onSaved` (bumped on close) refreshes the header so a newly-added target
 * surfaces its Deploy button.
 */
export function PublishDeployModal({
  project,
  onClose,
  onSaved,
}: {
  project: Project;
  /** Retained for call-site compatibility; the modal is now a single deploy-targets view. */
  initialTab?: 'publish' | 'deploy';
  onClose: () => void;
  onSaved?: () => void;
}) {
  return (
    <Modal
      title="Deploy targets"
      size="lg"
      onClose={() => {
        onSaved?.();
        onClose();
      }}
    >
      <div className="p-5">
        <p className="mb-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
          Deploy your site to a server. <strong className="font-bold text-slate-700">Local Hosting</strong> serves it on
          this platform at <code className="rounded bg-white px-1">/sites/{project.slug}/</code>;{' '}
          <strong>FTP / FTPS / SFTP</strong> upload it to your own external server. Final page assembly happens at deploy
          time.
        </p>
        <DeployForm project={project} />
      </div>
    </Modal>
  );
}
