import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { ghostButton, glassPanel } from '../../theme';

interface OneTimeSecretProps {
  /** Who the credential belongs to, so a second reset on a busy screen can't be misattributed. */
  label: string;
  secret: string;
  /** When the password stops working unless its owner has replaced it (ISO). */
  expiresAt?: string;
  onDismiss: () => void;
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * A credential shown EXACTLY once.
 *
 * Only the hash is stored, so there is no second chance to read this — which is the point (a password
 * an admin can re-read later is one the server could leak later). That makes dismissal destructive, so
 * it says so plainly and the copy button is the primary action rather than a convenience.
 *
 * Deliberately NOT a toast: a toast auto-dismisses, and a credential that vanishes on a timer while
 * the admin is switching to their password manager is worse than useless.
 *
 * Every password shown here is TEMPORARY — the person reading this panel has seen it, so its owner is
 * made to replace it. Saying so matters to whoever hands it over: "you will be asked to choose your
 * own" is part of the message, and so is the date it stops working.
 */
export function OneTimeSecret({ label, secret, expiresAt, onDismiss }: OneTimeSecretProps) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={`${glassPanel} mb-4 border border-amber-300/70 dark:border-amber-500/30 bg-amber-50/70 dark:bg-amber-500/10 p-3`} role="status">
      <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">Temporary password for {label}</p>
      <p className="mb-1 text-xs text-amber-800/80 dark:text-amber-200/70">
        Shown once — it is stored only as a hash and cannot be retrieved again. Copy it now and hand it over
        securely; if it is lost, issue a new one.
      </p>
      <p className="mb-2 text-xs text-amber-800/80 dark:text-amber-200/70">
        They will be asked to choose their own password the first time they sign in
        {expiresAt ? <>, and this one stops working on <strong>{formatDay(expiresAt)}</strong> if they have not</> : null}.
        Signing in through single sign-on instead discards it.
      </p>
      {/* The secret takes a row of its own when there is no room beside the buttons, and breaks rather
          than truncates: a credential shown once must be readable in full, on a phone too. */}
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 basis-56 select-all break-all rounded-lg bg-white/70 dark:bg-black/30 px-2 py-1.5 font-mono text-sm text-slate-800 dark:text-slate-100">
          {secret}
        </code>
        <button
          type="button"
          className={`${ghostButton} shrink-0 px-2 py-1 text-xs`}
          aria-label={`Copy the password for ${label}`}
          onClick={() => {
            void navigator.clipboard?.writeText(secret);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }}
        >
          {copied ? <span className="inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" /> Copied</span> : <span className="inline-flex items-center gap-1"><Copy className="h-3.5 w-3.5" /> Copy</span>}
        </button>
        <button type="button" className="shrink-0 text-xs text-amber-800 dark:text-amber-300 underline" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
