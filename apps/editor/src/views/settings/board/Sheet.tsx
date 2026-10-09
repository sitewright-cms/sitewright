import type { ReactNode } from 'react';
import { Modal } from '../../ui/Modal';
import { SectionHelp } from '../../ui/SectionHelp';

/** What every drill-in needs from the settings surface to save the section it belongs to. */
export interface SheetSave {
  /** Persists the active section. Resolves whether it persisted (the error has already been toasted). */
  onSave: () => Promise<boolean>;
  /** Whether the active section has unsaved changes. */
  dirty: boolean;
  saving: boolean;
}

/**
 * A settings DRILL-IN: one section's existing form, unchanged, in a modal over the board.
 *
 * Edits go into the same settings draft as before — the board only decides when you see the form. The
 * header's Save persists the section and closes; closing without saving keeps the edits PENDING, exactly
 * as the Shop and Consent modals always have, and the page's floating Save still holds them. Saving here
 * is real for the same reason the code editors' Save is: a modal whose Save only stages the change reads,
 * correctly, as "I saved and it didn't save".
 */
export function SettingsSheet({
  title,
  help,
  onClose,
  save,
  size = '2xl',
  children,
}: {
  title: string;
  /** The section's description — the "?" that used to sit on its card. */
  help?: string;
  onClose: () => void;
  save: SheetSave;
  size?: 'lg' | 'xl' | '2xl' | 'full';
  children: ReactNode;
}) {
  return (
    <Modal
      title={title}
      size={size}
      onClose={onClose}
      onSave={() => {
        void save.onSave().then((ok) => {
          if (ok) onClose();
        });
      }}
      saving={save.saving}
      saveDisabled={!save.dirty || save.saving}
      saveLabel="Save and close"
      titleExtra={help ? <SectionHelp tip={help} /> : undefined}
    >
      <div className="flex flex-col gap-4 p-5">
        {children}
        {save.dirty && (
          <p className="text-sm text-slate-500 dark:text-slate-400" role="status">
            Unsaved changes. Save with ✓ above, or close to keep them pending until you save the page.
          </p>
        )}
      </div>
    </Modal>
  );
}
