import { useEffect, useState } from 'react';
import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
import { api, ApiError, type PasskeyView } from '../api';
import { useToast } from './ui/Toast';
import { useDialogs } from './ui/Dialogs';
import { dangerButton, ghostButton, glassCard, glassPanel, primaryButton } from '../theme';

/**
 * The Security tab's Passkeys section: list, add (WebAuthn registration), rename, and remove the
 * user's passkeys. Registration runs entirely in the browser via @simplewebauthn/browser; the server
 * only sees the public attestation. Independent of the TOTP section.
 */
export function PasskeysSection() {
  const toast = useToast();
  const { confirm, prompt, dialog } = useDialogs();
  const [items, setItems] = useState<PasskeyView[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported = browserSupportsWebAuthn();

  async function load() {
    try {
      setItems((await api.listPasskeys()).items);
    } catch {
      /* keep whatever we have; the add/remove paths surface their own errors */
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function add() {
    setError(null);
    const name = await prompt({ title: 'Add a passkey', label: 'Name', initial: `Passkey ${items.length + 1}`, placeholder: 'e.g. MacBook Touch ID', confirmLabel: 'Continue' });
    if (name === null) return;
    const label = name.trim() || `Passkey ${items.length + 1}`;
    setBusy(true);
    try {
      const { options, handle } = await api.passkeyRegisterOptions();
      const response = await startRegistration({ optionsJSON: options });
      await api.passkeyRegisterVerify(handle, response, label);
      await load();
      toast.show('Passkey added', 'success');
    } catch (err) {
      // A user cancellation (NotAllowedError) or a verify failure both land here.
      setError(err instanceof ApiError ? err.message : 'Passkey setup was cancelled or didn’t complete.');
    } finally {
      setBusy(false);
    }
  }

  async function rename(pk: PasskeyView) {
    const name = await prompt({ title: 'Rename passkey', label: 'Name', initial: pk.name, confirmLabel: 'Save' });
    if (name === null || name.trim() === '' || name.trim() === pk.name) return;
    try {
      await api.renamePasskey(pk.id, name.trim());
      await load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'rename failed', 'error');
    }
  }

  async function remove(pk: PasskeyView) {
    if (!(await confirm({ title: 'Remove passkey', message: `Remove “${pk.name}”? You won’t be able to sign in with it anymore.`, confirmLabel: 'Remove' }))) return;
    try {
      await api.deletePasskey(pk.id);
      await load();
      toast.show('Passkey removed', 'success');
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'remove failed', 'error');
    }
  }

  return (
    <div className={`flex flex-col gap-3 ${glassCard} p-5`}>
      {dialog}
      <div>
        <h3 className="text-sm font-bold text-slate-800">Passkeys</h3>
        <p className="mt-0.5 text-sm text-slate-500">Sign in without a password using your device’s biometrics or a security key.</p>
      </div>
      {!supported && <p className="text-sm text-amber-600">This browser doesn’t support passkeys.</p>}
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {items.map((pk) => (
            <li key={pk.id} className={`flex items-center gap-3 ${glassPanel} px-4 py-2.5 text-sm`}>
              <span className="min-w-0 truncate font-medium text-slate-800">{pk.name}</span>
              <span className="shrink-0 text-xs text-slate-400">added {new Date(pk.createdAt).toLocaleDateString()}</span>
              <span className="ml-auto flex shrink-0 gap-1">
                <button type="button" className={ghostButton} onClick={() => void rename(pk)}>Rename</button>
                <button type="button" className={dangerButton} aria-label={`Remove ${pk.name}`} onClick={() => void remove(pk)}>Remove</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div>
        <button type="button" className={primaryButton} onClick={add} disabled={busy || !supported}>
          {busy ? 'Waiting for your device…' : 'Add a passkey'}
        </button>
      </div>
    </div>
  );
}
