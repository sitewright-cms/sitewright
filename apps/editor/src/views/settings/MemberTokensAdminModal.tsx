import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api, type MemberTokenAdminView, type MemberTokenStatus } from '../../api';
import { Modal } from '../ui/Modal';
import { useDialogs } from '../ui/Dialogs';
import { glassInput, glassPanel, dangerButton, toggleInput } from '../../theme';

/**
 * System settings → Security → Member tokens: every member token on the instance, with its owner.
 *
 * A member token reaches whatever its owner does — for an admin, every project — and until this list
 * the only way to find one was to open a project it happened to have touched. This is the place an
 * admin answers "what automation holds a key to this instance, and whose is it?", and revokes any of it.
 *
 * Working tokens are shown by default. Revoked and expired ones stay available behind a switch for as
 * long as housekeeping keeps their rows, because "which token was that, and when did it stop" is a
 * question asked after the fact.
 */

const STATUS: Record<MemberTokenStatus, { label: string; cls: string }> = {
  active: { label: 'Active', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
  expired: { label: 'Expired', cls: 'bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-slate-300' },
  revoked: { label: 'Revoked', cls: 'bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-slate-300' },
  suspended: { label: 'Owner is no longer staff', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
};

function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function ago(iso: string | null): string {
  if (!iso) return 'never used';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'used just now';
  if (ms < 3_600_000) return `used ${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `used ${Math.floor(ms / 3_600_000)}h ago`;
  return `last used ${day(iso)}`;
}

export function MemberTokensAdminModal({ onClose }: { onClose: () => void }) {
  const { confirm, dialog } = useDialogs();
  const [items, setItems] = useState<MemberTokenAdminView[] | null>(null);
  const [dailyMax, setDailyMax] = useState<number | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load(isActive: () => boolean = () => true) {
    try {
      const res = await api.listAllMemberTokens();
      if (!isActive()) return;
      setItems(res.items);
      setDailyMax(res.dailyProjectMax);
    } catch (err) {
      if (isActive()) setError(err instanceof Error ? err.message : 'failed to load member tokens');
    }
  }
  useEffect(() => {
    let active = true;
    void load(() => active);
    return () => {
      active = false;
    };
  }, []);

  async function revoke(t: MemberTokenAdminView) {
    setError(null);
    const ok = await confirm({
      title: 'Revoke member token',
      message: `Revoke “${t.name}”, owned by ${t.owner.email}? Anything using it stops working immediately, on every project. It cannot be undone — the owner would have to create a new one.`,
      confirmLabel: 'Revoke',
    });
    if (!ok) return;
    try {
      await api.revokeMemberTokenAsAdmin(t.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to revoke the member token');
    }
  }

  const all = items ?? [];
  const activeCount = all.filter((t) => t.status === 'active').length;
  const inactiveCount = all.length - activeCount;
  const needle = query.trim().toLowerCase();
  const shown = all.filter(
    (t) =>
      (showInactive || t.status === 'active') &&
      (needle === '' || t.name.toLowerCase().includes(needle) || t.owner.email.toLowerCase().includes(needle)),
  );

  return (
    <Modal title="Member tokens" size="lg" onClose={onClose}>
      {dialog}
      <div className="flex flex-col gap-4 p-5">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Every member token on this instance. A token acts as its owner on every project they can open — an admin’s
          token reaches all of them — limited to the capabilities listed.
        </p>

        {items === null && !error && (
          <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading member tokens…
          </p>
        )}

        {items !== null && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-sm font-medium text-slate-800 dark:text-slate-100" data-testid="member-token-counts">
              {activeCount} active{inactiveCount > 0 ? ` · ${inactiveCount} revoked or expired` : ''}
            </span>
            {inactiveCount > 0 && (
              <label className="ml-auto flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                <input type="checkbox" className={toggleInput} checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
                <span>Show revoked and expired</span>
              </label>
            )}
          </div>
        )}
        {all.length > 0 && (
          <input
            type="search"
            aria-label="Filter member tokens"
            placeholder="Filter by owner or name"
            className={`${glassInput} text-sm`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}

        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        {items !== null && (
          <ul className="flex flex-col gap-2">
            {shown.map((t) => {
              const status = STATUS[t.status];
              const limit = dailyMax === null ? null : Math.min(t.dailyProjectLimit ?? dailyMax, dailyMax);
              return (
                <li key={t.id} className={`flex flex-col gap-1.5 ${glassPanel} px-4 py-3 text-sm`}>
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span className="min-w-0 break-words font-medium text-slate-800 dark:text-slate-100">{t.name}</span>
                    <code className="text-xs text-slate-500 dark:text-slate-400">{t.tokenPrefix}…</code>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${status.cls}`}>{status.label}</span>
                    {t.status !== 'revoked' && (
                      <button
                        type="button"
                        aria-label={`Revoke member token ${t.name} of ${t.owner.email}`}
                        className={`ml-auto ${dangerButton}`}
                        onClick={() => void revoke(t)}
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-600 dark:text-slate-300">
                    <span className="min-w-0 break-all">{t.owner.email}</span>
                    {t.owner.role && (
                      <span className="rounded-full border border-white/60 bg-white/80 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:border-white/10 dark:bg-slate-900/80 dark:text-slate-300">
                        {t.owner.role}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{t.capabilities.join(', ')}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Created {day(t.createdAt)} · {t.status === 'expired' ? 'expired' : 'expires'} {day(t.expiresAt)} · {ago(t.lastUsedAt)}
                    {t.revokedAt ? ` · revoked ${day(t.revokedAt)}` : ''}
                    {t.projectsUsed > 0 ? ` · used on ${t.projectsUsed} ${t.projectsUsed === 1 ? 'project' : 'projects'}` : ''}
                    {t.capabilities.includes('projects:create') && limit !== null
                      ? ` · ${t.projectsCreatedToday} of ${limit} new projects in the last 24 hours`
                      : ''}
                  </p>
                </li>
              );
            })}
            {shown.length === 0 && (
              <li className="text-sm text-slate-500 dark:text-slate-400">
                {all.length === 0
                  ? 'No member tokens have been created on this instance.'
                  : needle !== ''
                    ? 'No member token matches that filter.'
                    : 'No active member tokens.'}
              </li>
            )}
          </ul>
        )}
      </div>
    </Modal>
  );
}
