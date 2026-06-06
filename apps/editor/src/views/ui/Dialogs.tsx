import { useCallback, useState, type ReactNode } from 'react';
import { Modal } from './Modal';
import { glassInput, primaryButton, ghostButton } from '../../theme';

/** A confirm dialog (replaces window.confirm): a message + Cancel / Confirm, danger-styled. */
export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for destructive actions (default true — most confirms are deletes). */
  danger?: boolean;
}

/** A prompt dialog (replaces window.prompt): a single labelled text field + Cancel / Save. */
export interface PromptOptions {
  title: string;
  label: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
}

const dangerButtonSolid =
  'inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-br from-rose-600 to-red-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-rose-600/30 transition hover:shadow-rose-600/40 disabled:opacity-60';

interface ConfirmState extends ConfirmOptions {
  kind: 'confirm';
  resolve: (ok: boolean) => void;
}
interface PromptState extends PromptOptions {
  kind: 'prompt';
  resolve: (value: string | null) => void;
}
type DialogState = ConfirmState | PromptState;

/**
 * Imperative modal dialogs that replace the native `window.confirm` / `window.prompt`.
 * `useDialogs()` returns `{ confirm, prompt, dialog }`: render `dialog` once in the view,
 * and `await confirm({...})` / `await prompt({...})` anywhere — each resolves when the
 * user acts. The dialogs stack correctly over other modals (the shared Modal stack).
 */
export function useDialogs() {
  const [state, setState] = useState<DialogState | null>(null);

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setState({ kind: 'confirm', danger: true, ...opts, resolve })),
    [],
  );
  const prompt = useCallback(
    (opts: PromptOptions) => new Promise<string | null>((resolve) => setState({ kind: 'prompt', ...opts, resolve })),
    [],
  );

  let dialog: ReactNode = null;
  if (state?.kind === 'confirm') {
    const done = (ok: boolean) => {
      state.resolve(ok);
      setState(null);
    };
    dialog = (
      <Modal title={state.title} size="md" onClose={() => done(false)}>
        <div className="flex flex-col gap-5 p-5">
          <div className="text-sm text-slate-600">{state.message}</div>
          <div className="flex justify-end gap-2">
            <button className={ghostButton} onClick={() => done(false)}>
              {state.cancelLabel ?? 'Cancel'}
            </button>
            <button className={state.danger ? dangerButtonSolid : primaryButton} onClick={() => done(true)} autoFocus>
              {state.confirmLabel ?? 'Confirm'}
            </button>
          </div>
        </div>
      </Modal>
    );
  } else if (state?.kind === 'prompt') {
    dialog = <PromptBody state={state} onClose={() => setState(null)} />;
  }

  return { confirm, prompt, dialog };
}

function PromptBody({ state, onClose }: { state: PromptState; onClose: () => void }) {
  const [value, setValue] = useState(state.initial ?? '');
  const submit = () => {
    state.resolve(value.trim() === '' ? null : value.trim());
    onClose();
  };
  const cancel = () => {
    state.resolve(null);
    onClose();
  };
  return (
    <Modal title={state.title} size="md" onClose={cancel}>
      <form
        className="flex flex-col gap-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim() !== '') submit();
        }}
      >
        <label className="flex flex-col text-xs font-semibold text-slate-700">
          {state.label}
          <input
            aria-label={state.label}
            className={`mt-1.5 font-normal ${glassInput}`}
            value={value}
            placeholder={state.placeholder}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostButton} onClick={cancel}>
            Cancel
          </button>
          <button type="submit" className={primaryButton} disabled={value.trim() === ''}>
            {state.confirmLabel ?? 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
