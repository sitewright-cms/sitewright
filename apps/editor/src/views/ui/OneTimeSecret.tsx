import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { ghostButton, glassPanel } from '../../theme';

interface OneTimeSecretProps {
  /** Who the credential belongs to, so a second reset on a busy screen can't be misattributed. */
  label: string;
  secret: string;
  onDismiss: () => void;
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
 */
export function OneTimeSecret({ label, secret, onDismiss }: OneTimeSecretProps) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={`${glassPanel} mb-4 border border-amber-300/70 dark:border-amber-500/30 bg-amber-50/70 dark:bg-amber-500/10 p-3`} role="status">
      <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">Password for {label}</p>
      <p className="mb-2 text-xs text-amber-800/80 dark:text-amber-200/70">
        Shown once — it is stored only as a hash and cannot be retrieved again. Copy it now and hand it over
        securely; if it is lost, issue a new one.
      </p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 select-all truncate rounded-lg bg-white/70 dark:bg-black/30 px-2 py-1.5 font-mono text-sm text-slate-800 dark:text-slate-100">
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
