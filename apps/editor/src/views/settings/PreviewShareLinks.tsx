import { useEffect, useState } from 'react';
import { Link2, Copy, Trash2, Plus, Check } from 'lucide-react';
import { api } from '../../api';
import { GlassCard } from './ui';
import { ghostButton, glassInput } from '../../theme';

type Share = { id: string; label: string; createdAt: number; url: string };

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

  const load = () =>
    api
      .listPreviewShares(projectId)
      .then((r) => setItems(r.items))
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
      const s = await api.createPreviewShare(projectId, label.trim());
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
    <GlassCard
      title="Preview share links"
      icon={<Link2 className="h-4 w-4" />}
      tooltip="Create a stable, revocable link that lets an UNAUTHENTICATED client view the live DRAFT preview (sandboxed — safe). The normal preview link expires and needs a logged-in member; share links do not. Delete a link to revoke it instantly."
    >
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
        <button className={ghostButton} disabled={busy} onClick={() => void create()}>
          <Plus className="h-4 w-4" /> Create
        </button>
      </div>
      {err && <div className="mb-2 text-xs text-error">{err}</div>}
      {items.length === 0 ? (
        <div className="text-xs opacity-60">No share links yet.</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((s) => (
            <li key={s.id} className="flex items-center gap-2 rounded-lg border border-base-300/40 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {s.label || 'Untitled'} <span className="opacity-50">· {new Date(s.createdAt).toLocaleDateString()}</span>
              </span>
              <button className={ghostButton} title="Copy link" onClick={() => flashCopied(s.id, s.url)}>
                {copied === s.id ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
              </button>
              <button className={ghostButton} title="Revoke" onClick={() => void revoke(s.id)}>
                <Trash2 className="h-4 w-4 text-error" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </GlassCard>
  );
}
