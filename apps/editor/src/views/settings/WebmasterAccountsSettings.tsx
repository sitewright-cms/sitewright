import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import {
  BING_API_KEY_RE,
  GOOGLE_KEY_FILE_MAX_BYTES,
  WEBMASTER_ACCOUNT_IN_USE,
  type WebmasterAccountInUse,
  type WebmasterAccountsInput,
  type WebmasterAccountsView,
  type WebmasterService,
} from '@sitewright/schema';
import { api, type ApiError } from '../../api';
import { secretFieldProps } from '../../lib/secret-field';
import { ghostButton, glassCard, glassInput } from '../../theme';
import { useDialogs } from '../ui/Dialogs';
import { SectionHelp } from '../ui/SectionHelp';

/**
 * SEARCH ENGINE ACCOUNTS in System Settings (instance admins): the platform's ONE Google service account and ONE
 * Bing Webmaster Tools account. Saved with the rest of the settings — the parent calls
 * {@link WebmasterAccountsSettingsHandle.save} after its own save succeeds. Neither secret is ever shown back:
 * Google shows only whose key is stored, Bing only that a key is.
 */

export interface WebmasterAccountsSettingsHandle {
  /** What is wrong with the form, checked BEFORE the parent saves anything; null when it can be saved. */
  validate: () => string | null;
  /** Saves what changed; resolves at once when nothing did. Throws with a message the parent shows. */
  save: () => Promise<void>;
}

/** A picked key file, read in the browser: its text goes to the server on save, its email is shown meanwhile. */
interface PickedKey {
  name: string;
  text: string;
  clientEmail: string;
}

/** A first look at a picked file, so a wrong one is named at once. The server checks it properly. */
function readKeyFile(text: string): { clientEmail: string } | string {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return 'That file is not a Google service-account key: it is not JSON.';
  }
  const rec = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (rec?.type !== 'service_account' || typeof rec.client_email !== 'string' || typeof rec.private_key !== 'string') {
    return 'That file is not a Google service-account key: create a JSON key on the service account (Keys → Add key).';
  }
  return { clientEmail: rec.client_email };
}

const ENGINE: Record<WebmasterService, string> = { google: 'Google', bing: 'Bing' };
const VERB: Record<WebmasterAccountInUse['action'], string> = { remove: 'Remove', replace: 'Replace' };

/**
 * The accounts of the server's refusal to remove or replace accounts sites are still registered with — one entry each,
 * with what the save would do to it and how many sites stay there — or null for any other error.
 */
function accountsInUse(err: unknown): WebmasterAccountInUse[] | null {
  if (!(err instanceof Error) || (err as Partial<ApiError>).code !== WEBMASTER_ACCOUNT_IN_USE) return null;
  const list = ((err as Partial<ApiError>).body as { accounts?: unknown } | undefined)?.accounts;
  if (!Array.isArray(list)) return null;
  const valid = list.filter(
    (a): a is WebmasterAccountInUse =>
      typeof a === 'object' && a !== null && (a.service === 'google' || a.service === 'bing') && (a.action === 'remove' || a.action === 'replace') && Number.isInteger(a.count) && typeof a.error === 'string',
  );
  return valid.length ? valid : null;
}

const muted = 'text-xs text-slate-500 dark:text-slate-400';
const removeLink = 'text-xs font-medium text-rose-600 dark:text-rose-400 hover:underline';

export const WebmasterAccountsSettings = forwardRef<WebmasterAccountsSettingsHandle>(function WebmasterAccountsSettings(_props, ref) {
  const [view, setView] = useState<WebmasterAccountsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState<PickedKey | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [removeGoogle, setRemoveGoogle] = useState(false);
  const [bingKey, setBingKey] = useState('');
  const [removeBing, setRemoveBing] = useState(false);
  const [tests, setTests] = useState<Partial<Record<WebmasterService, { ok: boolean; text: string }>>>({});
  const [testing, setTesting] = useState<WebmasterService | null>(null);
  const { confirm, dialog } = useDialogs();

  function hydrate(v: WebmasterAccountsView): void {
    setView(v);
    setPicked(null);
    setPickError(null);
    setRemoveGoogle(false);
    setBingKey('');
    setRemoveBing(false);
  }

  useEffect(() => {
    let live = true;
    api
      .getWebmasterAccounts()
      .then((v) => {
        if (live) hydrate(v);
      })
      .catch((err: unknown) => {
        if (live) setLoadError(err instanceof Error ? err.message : 'Could not load the search engine accounts');
      });
    return () => {
      live = false;
    };
  }, []);

  async function onPick(file: File | undefined): Promise<void> {
    setPicked(null);
    setPickError(null);
    if (!file) return;
    if (file.size > GOOGLE_KEY_FILE_MAX_BYTES) {
      setPickError('That file is too large to be a Google service-account key.');
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      setPickError('That file could not be read.');
      return;
    }
    const read = readKeyFile(text);
    if (typeof read === 'string') setPickError(read);
    else {
      setPicked({ name: file.name, text, clientEmail: read.clientEmail });
      setRemoveGoogle(false);
    }
  }

  const bingError = (): string | null =>
    bingKey.trim() && !BING_API_KEY_RE.test(bingKey.trim()) ? 'The Bing API key is 16 to 128 letters and digits: copy it from Bing Webmaster Tools → Settings → API Access.' : null;

  // ★ A refused key file is only a notice: it was never kept, so there is nothing wrong to save, and it must not
  // block the rest of System Settings (cancelling a file dialog fires no event to clear it).
  useImperativeHandle(ref, () => ({
    validate: () => (view ? bingError() : null),
    async save() {
      if (!view) return;
      const invalid = bingError();
      if (invalid) throw new Error(invalid);
      const input: WebmasterAccountsInput = {};
      if (picked) input.google = { keyFile: picked.text };
      else if (removeGoogle) input.google = null;
      if (bingKey.trim()) input.bing = { apiKey: bingKey.trim() };
      else if (removeBing) input.bing = null;
      if (Object.keys(input).length === 0) return;
      hydrate(await putConfirmingStrandedSites(input));
      setTests({});
    },
  }));

  /**
   * Saves; when that would remove or replace an account sites are still registered with, the server refuses with each
   * such account, what the save does to it and how many sites stay there. A key that no longer works can remove none of
   * them anyway, so the admin may go on — after reading, per account, what stays at it. Declined, nothing is saved and
   * the server's reason is what the parent shows.
   */
  async function putConfirmingStrandedSites(input: WebmasterAccountsInput): Promise<WebmasterAccountsView> {
    try {
      return await api.putWebmasterAccounts(input);
    } catch (err) {
      const accounts = accountsInUse(err);
      if (!accounts) throw err;
      const verbs = [...new Set(accounts.map((a) => VERB[a.action]))];
      const only = accounts.length === 1 ? accounts[0]! : null;
      const ok = await confirm({
        title: only ? `${VERB[only.action]} the ${ENGINE[only.service]} account anyway?` : 'Change both search engine accounts anyway?',
        message: (
          <>
            {accounts.map((a) => (
              <div key={a.service} className="mb-2">
                <p>{a.error}</p>
                <p className="mt-1 font-medium">
                  {only ? '' : `${ENGINE[a.service]}: `}
                  {VERB[a.action]} anyway — {a.count === 1 ? '1 site stays' : `${a.count} sites stay`} registered at the old account; remove {a.count === 1 ? 'it' : 'them'} there by hand.
                </p>
              </div>
            ))}
          </>
        ),
        confirmLabel: verbs.length === 1 ? `${verbs[0]} anyway` : 'Remove and replace anyway',
      });
      if (!ok) throw err;
      return api.putWebmasterAccounts({ ...input, force: true });
    }
  }

  async function runTest(service: WebmasterService): Promise<void> {
    setTesting(service);
    setTests((prev) => ({ ...prev, [service]: undefined }));
    try {
      const r = await api.testWebmasterAccount(service);
      setTests((prev) => ({ ...prev, [service]: r.ok ? { ok: true, text: r.detail ?? 'Connected' } : { ok: false, text: r.error ?? 'The test failed' } }));
    } catch (err) {
      setTests((prev) => ({ ...prev, [service]: { ok: false, text: err instanceof Error ? err.message : 'The test failed' } }));
    } finally {
      setTesting(null);
    }
  }

  const testRow = (service: WebmasterService, configured: boolean, link: { href: string; label: string }) => {
    const result = tests[service];
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button type="button" className={`${ghostButton} px-2 py-1 text-xs`} disabled={testing !== null || !configured} onClick={() => void runTest(service)}>
          {testing === service ? 'Testing…' : 'Test saved credentials'}
        </button>
        {!configured && <span className={muted}>Save first, then test.</span>}
        {result && (
          <span className={`text-xs ${result.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
            {result.ok ? '✓' : '✗'} {result.text}
          </span>
        )}
        <a href={link.href} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs underline">
          {link.label} <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      </div>
    );
  };

  return (
    <fieldset className={`${glassCard} p-4`}>
      <legend className="flex items-center gap-1.5 px-1 text-sm font-bold">
        Search engine accounts
        <SectionHelp tip="The platform's own Google service account and Bing Webmaster Tools account. Sites are registered with search engines under these, so clients need no Search Console or Bing account of their own. Both are encrypted at rest and never sent back to the browser." />
      </legend>
      {loadError && <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>}
      {view && (
        <div className="flex flex-col gap-4">
          <section aria-label="Google service account" className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200">Google (Search Console and Site Verification)</h3>
            <p className={muted}>
              {removeGoogle
                ? 'The stored key will be removed when you save.'
                : picked
                  ? `${picked.name}: the key for ${picked.clientEmail}, stored when you save.`
                  : view.google.configured
                    ? `Key stored for ${view.google.clientEmail} (Google Cloud project ${view.google.projectId}).`
                    : 'No key stored. Upload the JSON key file downloaded from the service account.'}
            </p>
            <div className="flex items-center gap-3">
              <label className="cursor-pointer text-xs font-medium text-indigo-700 dark:text-indigo-400 hover:underline">
                {view.google.configured || picked ? 'Replace key file' : 'Upload key file'}
                <input
                  type="file"
                  accept="application/json,.json"
                  aria-label="Google service-account key file"
                  className="sr-only"
                  onChange={(e) => {
                    void onPick(e.target.files?.[0]);
                    e.target.value = ''; // the same file can be picked again after a mistake
                  }}
                />
              </label>
              {(picked || (view.google.configured && !removeGoogle)) && (
                <button
                  type="button"
                  className={removeLink}
                  // Discarding a picked file goes back to what is stored; only "Remove" removes that.
                  onClick={() => {
                    setPickError(null);
                    if (picked) setPicked(null);
                    else setRemoveGoogle(true);
                  }}
                >
                  {picked ? 'Discard file' : 'Remove'}
                </button>
              )}
              {removeGoogle && (
                <button type="button" className={`${muted} hover:underline`} onClick={() => setRemoveGoogle(false)}>
                  Keep it
                </button>
              )}
            </div>
            {pickError && (
              <p className="text-xs text-rose-600 dark:text-rose-400">
                {pickError} Nothing from it will be saved.
              </p>
            )}
            {testRow('google', view.google.configured, { href: 'https://console.cloud.google.com/iam-admin/serviceaccounts', label: 'Google Cloud service accounts' })}
          </section>

          <section aria-label="Bing Webmaster Tools" className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200">Bing Webmaster Tools</h3>
            <label className={`flex flex-col ${muted}`}>
              API key
              <input
                className={glassInput}
                aria-label="Bing Webmaster API key"
                type="password"
                {...secretFieldProps}
                value={bingKey}
                placeholder={view.bing.configured && !removeBing ? '•••••• (leave blank to keep)' : ''}
                onChange={(e) => {
                  setBingKey(e.target.value);
                  if (e.target.value) setRemoveBing(false);
                }}
              />
              <span className="mt-1">
                {removeBing ? 'The stored key will be removed when you save.' : 'In Bing Webmaster Tools: Settings (the gear) → API Access → API Key.'}
              </span>
            </label>
            {view.bing.configured && !bingKey && (
              <div>
                <button type="button" className={removeBing ? `${muted} hover:underline` : removeLink} onClick={() => setRemoveBing(!removeBing)}>
                  {removeBing ? 'Keep it' : 'Remove'}
                </button>
              </div>
            )}
            {bingError() && <p className="text-xs text-rose-600 dark:text-rose-400">{bingError()}</p>}
            {testRow('bing', view.bing.configured, { href: 'https://www.bing.com/webmasters', label: 'Bing Webmaster Tools' })}
          </section>
        </div>
      )}
      {dialog}
    </fieldset>
  );
});
