import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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
  /** Optional helper note shown under the field (e.g. how the value is used). */
  note?: ReactNode;
}

const dangerButtonSolid =
  'inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-br from-rose-600 to-red-500 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-rose-600/30 transition hover:shadow-rose-600/40 disabled:opacity-60';

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
    dialog = <ConfirmBody state={state} onClose={() => setState(null)} />;
  } else if (state?.kind === 'prompt') {
    dialog = <PromptBody state={state} onClose={() => setState(null)} />;
  }

  return { confirm, prompt, dialog };
}

/** Confirm dialog body: ENTER applies the primary (confirm) action, ESC cancels (the Modal's close →
 *  `onClose` → resolve(false)). Both are the conventional shortcuts for a confirmation. */
function ConfirmBody({ state, onClose }: { state: ConfirmState; onClose: () => void }) {
  const resolved = useRef(false);
  const done = (ok: boolean) => {
    if (resolved.current) return; // one-shot — guards the Enter-key + button-click double-fire
    resolved.current = true;
    state.resolve(ok);
    onClose();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      // A confirm has no inputs; the textarea guard is defensive against a future multiline body.
      if ((document.activeElement as HTMLElement | null)?.tagName === 'TEXTAREA') return;
      e.preventDefault();
      done(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // Mount-only: this body exists for exactly one confirm; `state`/`done` are stable for its lifetime.
  }, []);
  return (
    <Modal title={state.title} size="md" onClose={() => done(false)}>
      <div className="flex flex-col gap-5 p-5">
        <div className="text-sm text-slate-600 dark:text-slate-300">{state.message}</div>
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
        <label className="flex flex-col text-xs font-bold text-slate-700 dark:text-slate-200">
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
        {state.note && (
          <p className="-mt-2 text-[11px] font-normal leading-relaxed text-slate-500 dark:text-slate-400">{state.note}</p>
        )}
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
