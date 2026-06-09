import { useState, type FormEvent } from 'react';
import type { Invite } from '../api';
import { useToast } from './ui/Toast';
import { useDialogs } from './ui/Dialogs';
import { glassCard, glassPanel, glassInput, fieldLabel, primaryButton, dangerButton } from '../theme';

interface InvitePanelProps {
  kind: 'developer' | 'client';
  invites: Invite[];
  onInvite: (email: string) => Promise<{ token: string }>;
  onRevoke: (id: string) => Promise<void>;
  onChanged: () => void | Promise<void>;
}

/** Builds the shareable invite link from a raw token. */
function inviteLink(token: string): string {
  return `${window.location.origin}/?invite=${encodeURIComponent(token)}`;
}

/**
 * Shared invite UI: invite by email, surface the one-time link to copy (no email infra),
 * and list/revoke pending invites. Used for both developer and client invites.
 */
export function InvitePanel({ kind, invites, onInvite, onRevoke, onChanged }: InvitePanelProps) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  const { confirm, dialog } = useDialogs();

  async function invite(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await onInvite(email.trim());
      setLink({ email: email.trim(), url: inviteLink(res.token) });
      setCopied(false);
      setEmail('');
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to send invite');
    } finally {
      setBusy(false);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.show('Invite link copied');
    } catch {
      // Clipboard may be unavailable (e.g. non-secure context) — the link is still shown to copy manually.
    }
  }

  async function revoke(id: string) {
    const email = invites.find((i) => i.id === id)?.email ?? 'this invite';
    const ok = await confirm({
      title: 'Revoke invite',
      message: `Revoke the pending invite for ${email}? The link stops working immediately.`,
      confirmLabel: 'Revoke',
    });
    if (!ok) return;
    setError(null);
    try {
      await onRevoke(id);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to revoke invite');
    }
  }

  const noun = kind === 'developer' ? 'developer' : 'client';

  return (
    <div>
      {link && (
        <div className="mb-4 rounded-2xl border border-amber-300/60 bg-amber-50/70 p-3 text-sm shadow-sm backdrop-blur-xl">
          <p className="font-medium text-amber-900">Invite link for {link.email}</p>
          <p className="mt-1 text-amber-800">
            Send this link to your {noun}. They accept by signing in (or registering) with that email.
          </p>
          <code className="mt-2 block overflow-x-auto rounded bg-white px-2 py-1 font-mono text-[12px] text-amber-900">
            {link.url}
          </code>
          <div className="mt-2 flex items-center gap-3">
            <button
              className="rounded border border-amber-400 px-2 py-0.5 text-xs text-amber-800 hover:bg-amber-100"
              onClick={() => copy(link.url)}
            >
              {copied ? 'Copied ✓' : 'Copy link'}
            </button>
            <button className="text-xs text-amber-700 underline" onClick={() => setLink(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {invites.length > 0 && (
        <ul className="mb-4 flex flex-col gap-1.5">
          {invites.map((inv) => (
            <li
              key={inv.id}
              className={`flex items-center justify-between ${glassPanel} px-3 py-2 text-sm`}
            >
              <span className="text-slate-600">
                {inv.email}
                <span className="ml-2 text-[11px] text-slate-400">pending · expires {new Date(inv.expiresAt).toLocaleDateString()}</span>
              </span>
              <button
                aria-label={`Revoke invite for ${inv.email}`}
                className={dangerButton}
                onClick={() => revoke(inv.id)}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={invite} className={`flex flex-wrap items-end gap-2 ${glassCard} p-4`}>
        <div className="flex flex-col">
          <label className={fieldLabel} htmlFor={`invite-email-${kind}`}>
            {kind === 'developer' ? 'Developer email' : 'Client email'}
          </label>
          <input
            id={`invite-email-${kind}`}
            aria-label={kind === 'developer' ? 'Developer email' : 'Client email'}
            type="email"
            className={glassInput}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={kind === 'developer' ? 'dev@agency.com' : 'client@example.com'}
            required
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className={primaryButton}
        >
          {busy ? 'Inviting…' : `Invite ${noun}`}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {dialog}
    </div>
  );
}
