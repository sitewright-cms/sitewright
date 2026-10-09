import { useEffect, useState } from 'react';
import { Copy, Trash2, Plus, Check, ExternalLink } from 'lucide-react';
import { api } from '../../api';
import { ghostButton, glassInput } from '../../theme';
import { Tooltip } from '../ui/Tooltip';

type Share = { id: string; label: string; createdAt: number; url: string; expiresAt?: number; expired?: boolean };

/** Expiry choices, in the order they are offered. `days: 0` is the explicit "never" — see the API. */
const EXPIRY_CHOICES = [
  { key: '1d', label: '1 day', days: 1 },
  { key: '1w', label: '1 week', days: 7 },
  { key: '30d', label: '30 days', days: 30 },
  { key: '1y', label: '1 year', days: 365 },
  { key: 'custom', label: 'Custom date…', days: null },
  { key: 'unlimited', label: 'Unlimited', days: 0 },
] as const;
type ExpiryKey = (typeof EXPIRY_CHOICES)[number]['key'];

/** How a lapsed-or-lapsing link reads in the row. */
function expiryLabel(s: Share): string {
  if (s.expiresAt === undefined) return 'never expires';
  if (s.expired) return `expired ${new Date(s.expiresAt).toLocaleDateString()}`;
  return `expires ${new Date(s.expiresAt).toLocaleDateString()}`;
}

/**
 * Self-contained (own state, no settings-form coupling) manager for REVOCABLE draft-preview SHARE links.
 * The default preview link is member-minted + time-bucketed → it expires (logged-in-only). A share link
 * here is STABLE and viewable by an UNAUTHENTICATED client (the sandboxed, opaque-origin preview), and is
 * revoked the moment it's deleted. The URL is app-origin-relative; we prepend the current origin to copy.
 */
export function PreviewShareLinks({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<Share[]>([]);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [expiryKey, setExpiryKey] = useState<ExpiryKey>('30d');
  const [customDate, setCustomDate] = useState('');

  const load = () =>
    api
      .listPreviewShares(projectId)
      .then((r) => {
        setItems(r.items);
        // Preselect the INSTANCE default so the dropdown agrees with what the server would do anyway.
        // An admin default that is not one of the presets (say 45 days) has no matching option, so the
        // selector stays where it is and the server's default still applies if nothing is changed.
        const match = EXPIRY_CHOICES.find((c) => c.days === r.defaultExpiryDays);
        if (match) setExpiryKey(match.key);
      })
      .catch(() => {});
  useEffect(() => {
    void load();
    // Re-load only when the project changes; `load` is stable for a given projectId. (This project's
    // eslint config does not register react-hooks/exhaustive-deps, so no disable directive is used.)
  }, [projectId]);

  const fullUrl = (u: string) => `${window.location.origin}${u}`;
  const flashCopied = (id: string, url: string) => {
    void navigator.clipboard?.writeText(fullUrl(url));
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };
  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const choice = EXPIRY_CHOICES.find((c) => c.key === expiryKey);
      // A custom date is sent as an explicit timestamp (end of the chosen day, so "expires on the 5th"
      // means the 5th is still usable); every other choice is a day count the server turns into one.
      const expiry =
        expiryKey === 'custom'
          ? customDate
            ? { expiresAt: new Date(`${customDate}T23:59:59`).getTime() }
            : {}
          : { expiryDays: choice?.days ?? undefined };
      const s = await api.createPreviewShare(projectId, label.trim(), expiry);
      setLabel('');
      await load();
      flashCopied(s.id, s.url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create the share link.');
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (id: string) => {
    await api.deletePreviewShare(projectId, id).catch(() => {});
    await load();
  };

  return (
    <div>
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
        Create a stable, revocable link that lets an <strong>unauthenticated</strong> client view the live
        DRAFT preview (sandboxed — safe). The normal preview link expires and needs a logged-in member;
        share links do not. Delete a link to revoke it instantly.
      </p>
      <div className="mb-3 flex gap-2">
        <input
          className={glassInput}
          placeholder="Label (e.g. Client review)"
          value={label}
          maxLength={120}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create();
          }}
        />
        <select
          aria-label="Link expiry"
          className={glassInput}
          value={expiryKey}
          onChange={(e) => setExpiryKey(e.target.value as ExpiryKey)}
        >
          {EXPIRY_CHOICES.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
        {expiryKey === 'custom' && (
          <input
            type="date"
            aria-label="Expiry date"
            className={glassInput}
            // No point offering a date already past — it would mint a link that is dead on arrival.
            min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}
            value={customDate}
            onChange={(e) => setCustomDate(e.target.value)}
          />
        )}
        <button className={ghostButton} disabled={busy || (expiryKey === 'custom' && !customDate)} onClick={() => void create()}>
          <Plus className="h-4 w-4" /> Create
        </button>
      </div>
      {err && <div className="mb-2 text-xs text-error">{err}</div>}
      {items.length === 0 ? (
        <div className="text-xs opacity-60">No share links yet.</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((s) => (
            // The WHOLE ROW opens the preview. A share link exists to be looked at, so that is the
            // row's primary action and it should not need aiming at a 16px glyph. It is a real
            // stretched <a> (`after:inset-0`), not a click handler on the <li>: middle-click, ⌘-click
            // and "copy link address" all keep working, and it stays keyboard-reachable. The action
            // buttons sit `relative` and later in DOM order, so they take their own clicks.
            <li
              key={s.id}
              // The tip rides on the ROW, not the link: the <a> is a stretched link
              // (after:absolute inset-0) whose overlay must resolve against this `relative` <li>.
              // Wrapping it — or making the <a> itself `relative` — shrinks the overlay to the link.
              data-tip="Open this preview in a new tab"
              className="tooltip waves-effect group relative flex items-center gap-2 rounded-lg border border-base-300/40 px-3 py-2 text-sm transition hover:border-base-300 hover:bg-slate-50 dark:hover:bg-white/5"
            >
              <a
                href={fullUrl(s.url)}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate after:absolute after:inset-0 after:content-['']"
              >
                <span className={s.expired ? 'text-slate-400 line-through dark:text-slate-500' : ''}>{s.label || 'Untitled'}</span>{' '}
                <span className={s.expired ? 'text-amber-600 dark:text-amber-400' : 'opacity-50'}>· {expiryLabel(s)}</span>
              </a>
              <Tooltip tip="Open in new tab">
                <a
                  href={fullUrl(s.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${ghostButton} relative`}
                  aria-label={`Open ${s.label || 'Untitled'} in a new tab`}
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Tooltip>
              <Tooltip tip="Copy link">
                <button aria-label="Copy link" className={`${ghostButton} relative`} onClick={() => flashCopied(s.id, s.url)}>
                  {copied === s.id ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                </button>
              </Tooltip>
              <Tooltip tip="Revoke">
                <button aria-label="Revoke" className={`${ghostButton} relative`} onClick={() => void revoke(s.id)}>
                  <Trash2 className="h-4 w-4 text-error" />
                </button>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
