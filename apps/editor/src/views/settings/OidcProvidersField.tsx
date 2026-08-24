import { useState } from 'react';
import { ghostButton, glassInput, toggleInput } from '../../theme';
import { secretFieldProps } from '../../lib/secret-field';

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
  return { _key: nextOidcProviderKey(), id: '', label: '', issuer: '', clientId: '', scopes: 'openid profile email', enabled: true, hasClientSecret: false, secret: '', usePkce: true };
}

interface OidcProvidersFieldProps {
  providers: OidcProviderDraft[];
  onChange: (next: OidcProviderDraft[]) => void;
  /** This instance's public origin — the redirect URL shown per provider is built from it. */
  origin: string;
}

const fieldLabel = 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300';

/**
 * The redirect URL this provider must be registered with, shown where it is configured.
 *
 * Every provider demands an EXACT match and rejects the sign-in otherwise, so the one string an admin
 * has to copy elsewhere was the one the form never showed — it lived in a help tooltip as a
 * `<id>`-shaped template that had to be assembled by hand. A mistyped or stale value fails only at the
 * END of the flow, after the consent screen, as a generic "we couldn't verify that sign-in", which is
 * the least debuggable moment for it to surface.
 */
function RedirectUrlRow({ origin, id, index }: { origin: string; id: string; index: number }) {
  const [copied, setCopied] = useState(false);
  const url = `${origin}/auth/oidc/${encodeURIComponent(id)}/callback`;
  const ready = id.trim() !== '';
  return (
    <div className="text-xs text-slate-500 dark:text-slate-400 sm:col-span-2">
      <span className={fieldLabel}>Redirect URL (register this with the provider)</span>
      {ready ? (
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg bg-slate-900/5 dark:bg-white/10 px-2 py-1.5 font-mono text-[11px] text-slate-700 dark:text-slate-200">{url}</code>
          <button
            type="button"
            className={`${ghostButton} shrink-0 px-2 py-1 text-xs`}
            aria-label={`Copy provider ${index + 1} redirect URL`}
            onClick={() => {
              void navigator.clipboard?.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      ) : (
        <p className="rounded-lg bg-slate-900/5 dark:bg-white/10 px-2 py-1.5 text-[11px] italic">Give the provider an id to see its redirect URL.</p>
      )}
    </div>
  );
}

/**
 * Admin editor for the configured OIDC single-sign-on providers (a controlled list). Each provider
 * carries a slug id (used in `/auth/oidc/<id>/…`), a button label, the issuer URL, client id, scopes,
 * an enabled toggle, and a write-only client secret (blank = keep the stored one).
 */
export function OidcProvidersField({ providers, onChange, origin }: OidcProvidersFieldProps) {
  const update = (i: number, patch: Partial<OidcProviderDraft>) => onChange(providers.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const remove = (i: number) => onChange(providers.filter((_, j) => j !== i));
  const add = () => onChange([...providers, blankOidcProvider()]);

  return (
    <div className="flex flex-col gap-3">
      {providers.length === 0 && <p className="text-xs text-slate-500 dark:text-slate-400">No providers yet — add one to offer “Sign in with …”.</p>}
      {providers.map((p, i) => (
        <div key={p._key} className="rounded-xl border border-white/60 dark:border-white/10 bg-white/40 dark:bg-white/5 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
              <input type="checkbox" className={toggleInput} checked={p.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} aria-label={`Provider ${i + 1} enabled`} />
              Enabled
            </label>
            <button type="button" className="text-sm font-medium text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-400" onClick={() => remove(i)} aria-label={`Remove provider ${i + 1}`}>
              Remove
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs text-slate-500 dark:text-slate-400">
              <span className={fieldLabel}>Id (slug)</span>
              <input className={glassInput} aria-label={`Provider ${i + 1} id`} value={p.id} placeholder="google" onChange={(e) => update(i, { id: e.target.value })} />
            </label>
            <label className="text-xs text-slate-500 dark:text-slate-400">
              <span className={fieldLabel}>Button label</span>
              <input className={glassInput} aria-label={`Provider ${i + 1} label`} value={p.label} placeholder="Google" onChange={(e) => update(i, { label: e.target.value })} />
            </label>
            <RedirectUrlRow origin={origin} id={p.id} index={i} />
            <label className="text-xs text-slate-500 dark:text-slate-400 sm:col-span-2">
              <span className={fieldLabel}>Issuer URL</span>
              <input className={glassInput} aria-label={`Provider ${i + 1} issuer`} value={p.issuer} placeholder="https://accounts.google.com" onChange={(e) => update(i, { issuer: e.target.value })} />
            </label>
            <label className="text-xs text-slate-500 dark:text-slate-400">
              <span className={fieldLabel}>Client ID</span>
              <input className={glassInput} aria-label={`Provider ${i + 1} client id`} value={p.clientId} onChange={(e) => update(i, { clientId: e.target.value })} />
            </label>
            <label className="text-xs text-slate-500 dark:text-slate-400">
              <span className={fieldLabel}>Client secret {'\u2014'} required if the provider issued one</span>
              <input
                className={glassInput}
                aria-label={`Provider ${i + 1} client secret`}
                type="password"
                {...secretFieldProps}
                value={p.secret}
                placeholder={p.hasClientSecret ? '•••••• (leave blank to keep)' : ''}
                onChange={(e) => update(i, { secret: e.target.value })}
              />
            </label>
            <label className="text-xs text-slate-500 dark:text-slate-400 sm:col-span-2">
              <span className={fieldLabel}>Scopes</span>
              <input className={glassInput} aria-label={`Provider ${i + 1} scopes`} value={p.scopes} placeholder="openid profile email" onChange={(e) => update(i, { scopes: e.target.value })} />
            </label>
            <label className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300 sm:col-span-2">
              <input type="checkbox" className={toggleInput} checked={p.usePkce} onChange={(e) => update(i, { usePkce: e.target.checked })} aria-label={`Provider ${i + 1} use PKCE`} />
              <span>
                <span className="font-medium">Use PKCE (S256)</span>
                <span className="block text-slate-500 dark:text-slate-400">
                  On by default; leave it on unless the provider rejects the <code>code_challenge</code> parameter.
                  PKCE does NOT replace the client secret — it protects the authorization code, while the secret
                  authenticates this app at the token endpoint. If your provider issued a secret (Google
                  “Web application” clients always do), enter it above even with PKCE on. Only a public client —
                  one issued no secret at all — relies on PKCE alone.
                </span>
              </span>
            </label>
          </div>
        </div>
      ))}
      <div>
        <button type="button" className="rounded-lg border border-white/60 dark:border-white/10 bg-white/50 dark:bg-white/5 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-white/10" onClick={add}>
          Add provider
        </button>
      </div>
    </div>
  );
}
