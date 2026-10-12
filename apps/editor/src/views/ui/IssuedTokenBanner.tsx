import { X } from 'lucide-react';

interface IssuedTokenBannerProps {
  /** The raw token — this is the only time the server returns it. */
  token: string;
  /** Accessible name of the token readout (e.g. "New API token"). */
  label: string;
  onDismiss: () => void;
}

/** The copy-it-now banner shown once after a token is minted. Shared by the project-token and
 *  member-token managers so the one place a secret is on screen looks and behaves the same in both. */
export function IssuedTokenBanner({ token, label, onDismiss }: IssuedTokenBannerProps) {
  return (
    <div className="rounded-2xl border border-amber-300/70 dark:border-amber-500/20 bg-amber-50/80 dark:bg-amber-500/10 p-4 shadow-lg shadow-amber-500/10 backdrop-blur-3xl">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-bold text-amber-900 dark:text-amber-200">Copy your new token now — it won’t be shown again.</p>
        <button
          type="button"
          aria-label="Dismiss token"
          className="text-amber-700 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-200"
          onClick={onDismiss}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <code className="mt-2 block break-all rounded-lg border border-amber-200/70 dark:border-amber-500/20 bg-white/80 dark:bg-slate-900/80 px-3 py-2 text-xs" aria-label={label}>
        {token}
      </code>
    </div>
  );
}
