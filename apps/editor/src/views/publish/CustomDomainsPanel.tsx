import { useEffect, useState } from 'react';
import { Globe, Check, Clock, AlertTriangle } from 'lucide-react';
import { api, ApiError, type ProjectDomainView } from '../../api';
import { useToast } from '../ui/Toast';
import { useDialogs } from '../ui/Dialogs';
import { dangerButton, ghostButton, glassInput, glassPanel, primaryButton } from '../../theme';

/**
 * Custom domains for a locally-hosted site: claim a hostname, publish a TXT record, verify, and pick
 * which one the site calls itself.
 *
 * ★ The panel is honest about the two things outside the platform's control. A claim serves nothing
 * until DNS proves ownership, so an unverified row says exactly which record to publish rather than
 * looking like a configured domain that is mysteriously down. And the certificate is the reverse
 * proxy's job — the platform routes by `Host` and cannot issue TLS — so that is stated next to the
 * verified state instead of being discovered as a browser warning.
 */
export function CustomDomainsPanel({ projectId, isStaff }: { projectId: string; isStaff: boolean }) {
  const toast = useToast();
  const { confirm, dialog } = useDialogs();
  const [items, setItems] = useState<ProjectDomainView[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Per-domain DNS feedback from the last verify attempt (pending vs actually wrong). */
  const [checks, setChecks] = useState<Record<string, { state: string; detail: string }>>({});

  async function load() {
    try {
      setItems((await api.listProjectDomains(projectId)).items);
    } catch {
      /* the add/verify paths surface their own errors */
    }
  }
  useEffect(() => {
    void load();
  }, [projectId]);

  async function claim() {
    const host = draft.trim();
    if (!host) return;
    setBusy(true);
    setError(null);
    try {
      await api.claimProjectDomain(projectId, host);
      setDraft('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'could not claim that hostname');
    } finally {
      setBusy(false);
    }
  }

  async function verify(d: ProjectDomainView) {
    setBusy(true);
    try {
      const res = await api.verifyProjectDomain(projectId, d.id);
      if (res.verified) {
        toast.show(`${d.host} verified`, 'success');
        // Drop this domain's stale DNS feedback — it verified, so the old "not found yet" is misleading.
        setChecks((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => id !== d.id)));
        await load();
      } else {
        // Not an error: a record that has not propagated yet is the expected first answer.
        setChecks((prev) => ({ ...prev, [d.id]: { state: res.state ?? 'pending', detail: res.detail ?? '' } }));
      }
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'verification failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function forceVerify(d: ProjectDomainView) {
    if (
      !(await confirm({
        title: 'Verify without a DNS check',
        message: `Mark ${d.host} as verified without checking DNS? Only do this when you know DNS for it already points here — the platform will start serving this site on that hostname.`,
        confirmLabel: 'Verify anyway',
      }))
    )
      return;
    try {
      await api.forceVerifyProjectDomain(projectId, d.id);
      await load();
      toast.show(`${d.host} verified`, 'success');
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'could not verify', 'error');
    }
  }

  async function makePrimary(d: ProjectDomainView) {
    try {
      setItems((await api.setPrimaryProjectDomain(projectId, d.id)).items);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'could not change the primary domain', 'error');
    }
  }

  async function release(d: ProjectDomainView) {
    if (
      !(await confirm({
        title: 'Remove domain',
        message: `Stop serving this site at ${d.host}? The hostname becomes available to other projects, and visitors will no longer reach the site there.`,
        confirmLabel: 'Remove',
      }))
    )
      return;
    try {
      await api.releaseProjectDomain(projectId, d.id);
      await load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'could not remove the domain', 'error');
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {dialog}
      <div>
        <h4 className="flex items-center gap-1.5 text-sm font-bold text-slate-800 dark:text-slate-100">
          <Globe className="h-4 w-4" aria-hidden /> Custom domains
        </h4>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          Serve this site at the client&apos;s own hostname. Point its DNS here, publish the TXT record shown below, then
          verify — the site starts serving on that hostname once verification succeeds.
        </p>
      </div>

      {items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {items.map((d) => {
            const check = checks[d.id];
            return (
              <li key={d.id} className={`flex flex-col gap-2 ${glassPanel} px-3 py-2.5 text-sm`}>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="font-medium">{d.host}</code>
                  {d.isPrimary && (
                    <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
                      primary
                    </span>
                  )}
                  {d.verified ? (
                    <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                      <Check className="h-3 w-3" aria-hidden /> verified
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                      <Clock className="h-3 w-3" aria-hidden /> not serving yet
                    </span>
                  )}
                  <span className="ml-auto flex shrink-0 flex-wrap gap-1">
                    {!d.verified && (
                      <button type="button" className={ghostButton} disabled={busy} onClick={() => void verify(d)}>
                        Check DNS
                      </button>
                    )}
                    {!d.verified && isStaff && (
                      <button type="button" className={ghostButton} onClick={() => void forceVerify(d)}>
                        Verify without DNS
                      </button>
                    )}
                    {d.verified && !d.isPrimary && (
                      <button type="button" className={ghostButton} onClick={() => void makePrimary(d)}>
                        Make primary
                      </button>
                    )}
                    <button type="button" className={dangerButton} aria-label={`Remove ${d.host}`} onClick={() => void release(d)}>
                      Remove
                    </button>
                  </span>
                </div>

                {!d.verified && (
                  <div className="rounded-lg border border-slate-200 bg-white/70 px-2.5 py-2 text-xs dark:border-white/10 dark:bg-white/5">
                    <p className="mb-1 font-medium">Publish this DNS record, then choose “Check DNS”:</p>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                      <dt className="text-slate-500 dark:text-slate-400">Type</dt>
                      <dd>
                        <code>{d.dns.type}</code>
                      </dd>
                      <dt className="text-slate-500 dark:text-slate-400">Name</dt>
                      <dd className="min-w-0 break-all">
                        <code>{d.dns.name}</code>
                      </dd>
                      <dt className="text-slate-500 dark:text-slate-400">Value</dt>
                      <dd className="min-w-0 break-all">
                        <code>{d.dns.value}</code>
                      </dd>
                    </dl>
                  </div>
                )}

                {check && (
                  <p
                    className={`flex items-start gap-1.5 text-xs ${
                      check.state === 'pending' ? 'text-slate-500 dark:text-slate-400' : 'text-rose-600 dark:text-rose-400'
                    }`}
                    role="status"
                  >
                    {check.state !== 'pending' && <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />}
                    {check.detail}
                  </p>
                )}

                {d.verified && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Your reverse proxy must hold a TLS certificate for <code>{d.host}</code> — the platform routes the
                    hostname but cannot issue certificates.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-start gap-2">
        <input
          className={`${glassInput} min-w-[14rem] flex-1`}
          aria-label="Custom domain to add"
          placeholder="www.clientbrand.com"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            // Enter adds the domain rather than submitting any enclosing form.
            if (e.key === 'Enter') {
              e.preventDefault();
              void claim();
            }
          }}
        />
        <button type="button" className={primaryButton} disabled={busy || !draft.trim()} onClick={() => void claim()}>
          Add domain
        </button>
      </div>
      {error && (
        <p className="text-xs text-rose-600 dark:text-rose-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
