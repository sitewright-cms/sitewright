import { glassInput, toggleInput } from '../../theme';

/** An editable OIDC provider row. `scopes` is a space/comma string for the textbox; `secret` is a
 *  newly-typed plaintext client secret (write-only — blank keeps the stored one). `_key` is a stable
 *  React key (the provider id can be blank/edited, so it can't be the key). */
export interface OidcProviderDraft {
  _key: string;
  id: string;
  label: string;
  issuer: string;
  clientId: string;
  scopes: string;
  enabled: boolean;
  hasClientSecret: boolean;
  secret: string;
  /** Auto-provision a new account for a verified email this provider returns that matches no user/invite. */
  autoRegister: boolean;
  /** Use PKCE (S256). Default on; turn off only for an IdP that rejects the code_challenge param. */
  usePkce: boolean;
}

// A monotonic counter for React keys (unique-per-session). NOT crypto.randomUUID: that is only
// defined in a secure context, so it is absent over the plain-HTTP preview/DinD host — calling it
// there throws, which previously made "Add provider" silently do nothing.
let keySeq = 0;
export function nextOidcProviderKey(): string {
  keySeq += 1;
  return `oidc-${keySeq}`;
}

/** A blank provider row (the "Add" target), with a fresh stable key. */
export function blankOidcProvider(): OidcProviderDraft {
  return { _key: nextOidcProviderKey(), id: '', label: '', issuer: '', clientId: '', scopes: 'openid profile email', enabled: true, hasClientSecret: false, secret: '', autoRegister: false, usePkce: true };
}

interface OidcProvidersFieldProps {
  providers: OidcProviderDraft[];
  onChange: (next: OidcProviderDraft[]) => void;
}

const fieldLabel = 'mb-1 block text-xs font-medium text-slate-600';

/**
 * Admin editor for the configured OIDC single-sign-on providers (a controlled list). Each provider
 * carries a slug id (used in `/auth/oidc/<id>/…`), a button label, the issuer URL, client id, scopes,
 * an enabled toggle, and a write-only client secret (blank = keep the stored one).
 */
export function OidcProvidersField({ providers, onChange }: OidcProvidersFieldProps) {
  const update = (i: number, patch: Partial<OidcProviderDraft>) => onChange(providers.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const remove = (i: number) => onChange(providers.filter((_, j) => j !== i));
  const add = () => onChange([...providers, blankOidcProvider()]);

  return (
    <div className="flex flex-col gap-3">
      {providers.length === 0 && <p className="text-xs text-slate-400">No providers yet — add one to offer “Sign in with …”.</p>}
      {providers.map((p, i) => (
        <div key={p._key} className="rounded-xl border border-white/60 bg-white/40 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input type="checkbox" className={toggleInput} checked={p.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} aria-label={`Provider ${i + 1} enabled`} />
              Enabled
            </label>
            <button type="button" className="text-sm font-medium text-rose-600 hover:text-rose-700" onClick={() => remove(i)} aria-label={`Remove provider ${i + 1}`}>
              Remove
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs text-slate-500">
              <span className={fieldLabel}>Id (slug)</span>
              <input className={glassInput} aria-label={`Provider ${i + 1} id`} value={p.id} placeholder="google" onChange={(e) => update(i, { id: e.target.value })} />
            </label>
            <label className="text-xs text-slate-500">
              <span className={fieldLabel}>Button label</span>
              <input className={glassInput} aria-label={`Provider ${i + 1} label`} value={p.label} placeholder="Google" onChange={(e) => update(i, { label: e.target.value })} />
            </label>
            <label className="text-xs text-slate-500 sm:col-span-2">
              <span className={fieldLabel}>Issuer URL</span>
              <input className={glassInput} aria-label={`Provider ${i + 1} issuer`} value={p.issuer} placeholder="https://accounts.google.com" onChange={(e) => update(i, { issuer: e.target.value })} />
            </label>
            <label className="text-xs text-slate-500">
              <span className={fieldLabel}>Client ID</span>
              <input className={glassInput} aria-label={`Provider ${i + 1} client id`} value={p.clientId} onChange={(e) => update(i, { clientId: e.target.value })} />
            </label>
            <label className="text-xs text-slate-500">
              <span className={fieldLabel}>Client secret</span>
              <input
                className={glassInput}
                aria-label={`Provider ${i + 1} client secret`}
                type="password"
                value={p.secret}
                placeholder={p.hasClientSecret ? '•••••• (leave blank to keep)' : ''}
                onChange={(e) => update(i, { secret: e.target.value })}
              />
            </label>
            <label className="text-xs text-slate-500 sm:col-span-2">
              <span className={fieldLabel}>Scopes</span>
              <input className={glassInput} aria-label={`Provider ${i + 1} scopes`} value={p.scopes} placeholder="openid profile email" onChange={(e) => update(i, { scopes: e.target.value })} />
            </label>
            <label className="flex items-start gap-2 text-xs text-slate-600 sm:col-span-2">
              <input type="checkbox" className={toggleInput} checked={p.autoRegister} onChange={(e) => update(i, { autoRegister: e.target.checked })} aria-label={`Provider ${i + 1} auto-register`} />
              <span>
                <span className="font-medium">Auto-register new users</span>
                <span className="block text-slate-500">Create an account for any verified email from this provider that isn’t already a user or invited. New users get no project access until they create a project or an admin grants one.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs text-slate-600 sm:col-span-2">
              <input type="checkbox" className={toggleInput} checked={p.usePkce} onChange={(e) => update(i, { usePkce: e.target.checked })} aria-label={`Provider ${i + 1} use PKCE`} />
              <span>
                <span className="font-medium">Use PKCE (S256)</span>
                <span className="block text-slate-500">On by default. Turn off only if the provider rejects PKCE — disabling it needs a client secret (a public client without PKCE is insecure).</span>
              </span>
            </label>
          </div>
        </div>
      ))}
      <div>
        <button type="button" className="rounded-lg border border-white/60 bg-white/50 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-white" onClick={add}>
          Add provider
        </button>
      </div>
    </div>
  );
}
