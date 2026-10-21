import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Circle, Loader2, MinusCircle, XCircle } from 'lucide-react';
import type { DeployTargetView, SiteRegistrationView, WebmasterService } from '@sitewright/schema';
import { api } from '../../api';
import { primaryButton } from '../../theme';
import { Modal } from '../ui/Modal';

/**
 * VERIFY WITH SEARCH ENGINES — the one action that registers a site with the platform's Google and Bing accounts,
 * shown step by step as it runs:
 *
 *   1. the deploy target that serves the Production URL is reachable (Local Hosting when its address IS the
 *      Production URL; else the project's remote target — asked for when there are several);
 *   2. each switched-on search engine's verification tag;
 *   3. a deploy to THAT target, so the live pages carry the tags (no other target is touched);
 *   4. each search engine confirms its tag on the live site (Google then adds the site to Search Console).
 *
 * A step that fails stops the ones that need it, and says why.
 */

type StepState = 'waiting' | 'running' | 'done' | 'failed' | 'skipped';
interface Step {
  id: string;
  label: string;
  state: StepState;
  detail?: string;
  /** 0..1 while the deploy reports how far it got. */
  progress?: number;
}

const ENGINE: Record<WebmasterService, string> = { google: 'Google Search Console', bing: 'Bing Webmaster Tools' };
const PROTOCOL: Record<string, string> = { local: 'Local Hosting', ftp: 'FTP', ftps: 'FTPS', sftp: 'SFTP', git: 'git' };

function StepIcon({ state }: { state: StepState }) {
  const cls = 'mt-0.5 h-4 w-4 shrink-0';
  if (state === 'running') return <Loader2 className={`${cls} animate-spin text-indigo-500`} aria-hidden />;
  if (state === 'done') return <CheckCircle2 className={`${cls} text-emerald-600 dark:text-emerald-400`} aria-hidden />;
  if (state === 'failed') return <XCircle className={`${cls} text-rose-600 dark:text-rose-400`} aria-hidden />;
  if (state === 'skipped') return <MinusCircle className={`${cls} text-slate-400`} aria-hidden />;
  return <Circle className={`${cls} text-slate-300 dark:text-slate-600`} aria-hidden />;
}

const message = (err: unknown, fallback: string): string => (err instanceof Error && err.message ? err.message : fallback);
const hostOf = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(url, 'https://placeholder.invalid').host.toLowerCase();
  } catch {
    return null;
  }
};

/** Which target serves the Production URL: one found, a choice to make, or none (and why). */
type Choice = { target: DeployTargetView } | { pick: DeployTargetView[] } | { none: string };

function chooseTarget(targets: DeployTargetView[], siteUrl: string, localUrl: string | null): Choice {
  const local = targets.find((t) => t.protocol === 'local');
  const siteHost = hostOf(siteUrl);
  if (local && siteHost && hostOf(localUrl) === siteHost) return { target: local };
  const remote = targets.filter((t) => t.protocol !== 'local');
  if (remote.length === 1) return { target: remote[0]! };
  if (remote.length > 1) {
    // The most recently deployed first: the likeliest to be the one the Production URL points at.
    return { pick: [...remote].sort((a, b) => String(b.lastDeployedAt ?? '').localeCompare(String(a.lastDeployedAt ?? ''))) };
  }
  if (local) return { none: `Local Hosting serves ${hostOf(localUrl) ?? 'another address'}, not ${siteUrl}, and the project has no other deploy target.` };
  return { none: 'This project has no deploy target. Add one with Deploy, then verify again.' };
}

export function SearchEngineVerify({ projectId, view, onClose }: { projectId: string; view: SiteRegistrationView; onClose: () => void }) {
  const engines = (['google', 'bing'] as const).filter((s) => view[s].enabled);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [target, setTarget] = useState<DeployTargetView | null>(null);
  const [steps, setSteps] = useState<Step[]>(() => [
    { id: 'target', label: 'Checking the deploy target', state: 'running' },
    { id: 'tags', label: 'Getting the verification tags', state: 'waiting' },
    { id: 'deploy', label: 'Deploying the website', state: 'waiting' },
    ...engines.map((s) => ({ id: `verify:${s}`, label: `Verifying with ${ENGINE[s]}`, state: 'waiting' as StepState })),
  ]);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);
  const abort = useRef<AbortController>(new AbortController());
  const loaded = useRef(false);
  const ran = useRef(false);

  const update = (id: string, patch: Partial<Step>): void => setSteps((all) => all.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  // A step that failed leaves the ones after it with nothing to do.
  const stop = (text: string): void => {
    setSteps((all) => all.map((s) => (s.state === 'waiting' ? { ...s, state: 'skipped' } : s)));
    setOutcome({ ok: false, text });
  };

  // Which target serves the Production URL. Once: React's development double-mount must not ask twice.
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void (async () => {
      try {
        const [{ items }, status] = await Promise.all([api.listDeployTargets(projectId), api.publishStatus(projectId).catch(() => null)]);
        const c = chooseTarget(items, view.siteUrl ?? '', status?.url ?? null);
        setChoice(c);
        if ('target' in c) setTarget(c.target);
        else if ('pick' in c) {
          setPicked(c.pick[0]!.id);
          update('target', { state: 'waiting', detail: `Which target serves ${view.siteUrl}?` });
        } else {
          update('target', { state: 'failed', detail: c.none });
          stop('Nothing was verified.');
        }
      } catch (err) {
        update('target', { state: 'failed', detail: message(err, 'Could not read the deploy targets') });
        stop('Nothing was verified.');
      }
    })();
    // The targets are read once, for the view the window was opened with.
  }, []);

  // The run, once a target is known.
  useEffect(() => {
    if (!target || ran.current) return;
    ran.current = true;
    const signal = abort.current.signal;
    void (async () => {
      // 1. The target must answer before anything is sent.
      update('target', { state: 'running', label: `Checking ${target.name}`, detail: undefined });
      if (target.protocol === 'local') {
        update('target', { state: 'done', detail: `Local Hosting serves ${view.siteUrl}` });
      } else {
        try {
          const test = await api.testDeployTarget(projectId, { id: target.id });
          if (!test.ok) {
            update('target', { state: 'failed', detail: test.failure?.message ?? test.steps.find((s) => s.status === 'failed')?.detail ?? `${target.name} did not answer` });
            return stop('Nothing was verified.');
          }
          update('target', { state: 'done', detail: `${PROTOCOL[target.protocol] ?? target.protocol} · ${target.host ?? target.name} answers` });
        } catch (err) {
          update('target', { state: 'failed', detail: message(err, `Could not test ${target.name}`) });
          return stop('Nothing was verified.');
        }
      }

      // 2. The tags the deploy will carry.
      update('tags', { state: 'running' });
      let ready: WebmasterService[];
      try {
        const { results } = await api.prepareSiteRegistration(projectId);
        ready = engines.filter((s) => results[s]?.ok);
        update('tags', {
          state: ready.length ? 'done' : 'failed',
          detail: engines.map((s) => `${s === 'google' ? 'Google' : 'Bing'}: ${results[s]?.detail ?? 'not asked'}`).join(' · '),
        });
        for (const s of engines) if (!ready.includes(s)) update(`verify:${s}`, { state: 'skipped', detail: 'No tag to verify' });
      } catch (err) {
        update('tags', { state: 'failed', detail: message(err, 'Could not get the verification tags') });
        return stop('Nothing was verified.');
      }
      if (ready.length === 0) return stop('Nothing was verified.');

      // 3. Deploy that target, so the live pages carry the tags.
      if (signal.aborted) return;
      update('deploy', { state: 'running', label: `Deploying to ${target.name}` });
      try {
        if (target.protocol === 'local') {
          await api.publish(projectId);
          update('deploy', { state: 'done', detail: 'Published on Local Hosting' });
        } else {
          const result: { error: string | null; summary: string } = { error: null, summary: 'Deployed' };
          await api.deployTargetStream(
            projectId,
            target.id,
            {
              onProgress: (e) => {
                if (e.total && e.index !== undefined) update('deploy', { progress: Math.min(1, (e.index + 1) / e.total), detail: `${e.index + 1} of ${e.total} files` });
                else if (e.phase) update('deploy', { detail: e.phase });
              },
              onDone: (d) => {
                const sent = d.uploaded ?? d.files;
                if (sent !== undefined) result.summary = `Deployed · ${sent} file${sent === 1 ? '' : 's'} sent`;
              },
              onError: (m) => {
                result.error = m;
              },
            },
            signal,
          );
          if (result.error) {
            update('deploy', { state: 'failed', detail: result.error, progress: undefined });
            return stop('Nothing was verified: the tags are not on the live site.');
          }
          update('deploy', { state: 'done', detail: result.summary, progress: undefined });
        }
      } catch (err) {
        update('deploy', { state: 'failed', detail: message(err, 'The deploy failed'), progress: undefined });
        return stop('Nothing was verified: the tags are not on the live site.');
      }

      // 4. Each search engine looks for its tag on the live site.
      const verified: string[] = [];
      const notVerified: string[] = [];
      for (const s of ready) {
        if (signal.aborted) return;
        update(`verify:${s}`, { state: 'running' });
        try {
          const { result } = await api.verifySiteRegistration(projectId, s);
          update(`verify:${s}`, { state: result.ok ? 'done' : 'failed', detail: result.detail });
          (result.ok ? verified : notVerified).push(ENGINE[s]);
        } catch (err) {
          update(`verify:${s}`, { state: 'failed', detail: message(err, 'Could not ask the search engine') });
          notVerified.push(ENGINE[s]);
        }
      }
      setOutcome(
        notVerified.length === 0
          ? { ok: true, text: `Verified with ${verified.join(' and ')}.` }
          : { ok: false, text: `${verified.length ? `Verified with ${verified.join(' and ')}; ` : ''}not verified with ${notVerified.join(' and ')}. The reasons are above.` },
      );
    })();
    // No cleanup abort: under StrictMode the first cleanup would stop the only run. Closing the window stops it.
  }, [target]);

  const pickList = choice && 'pick' in choice && !target ? choice.pick : null;
  return (
    <Modal
      title="Verify with search engines"
      size="md"
      onClose={() => {
        abort.current.abort();
        onClose();
      }}
    >
      <div className="flex flex-col gap-4 p-5">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Registers <span className="font-medium text-slate-800 dark:text-slate-100">{view.siteUrl}</span> with the platform’s accounts.
        </p>
        {pickList && (
          <fieldset className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <legend className="px-1 text-sm font-medium text-slate-700 dark:text-slate-200">Which deploy target serves {view.siteUrl}?</legend>
            {pickList.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input type="radio" name="verify-target" checked={picked === t.id} onChange={() => setPicked(t.id)} />
                <span className="font-medium">{t.name}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {PROTOCOL[t.protocol] ?? t.protocol}
                  {t.host ? ` · ${t.host}` : ''}
                </span>
              </label>
            ))}
            <span>
              <button type="button" className={primaryButton} disabled={!picked} onClick={() => setTarget(pickList.find((t) => t.id === picked) ?? null)}>
                Deploy and verify
              </button>
            </span>
          </fieldset>
        )}
        <ol className="flex flex-col gap-2" aria-label="Verification steps">
          {steps.map((s) => (
            <li key={s.id} className="flex items-start gap-2 text-sm" data-state={s.state}>
              <StepIcon state={s.state} />
              <span className="min-w-0 flex-1">
                <span className="font-medium text-slate-800 dark:text-slate-100">{s.label}</span>
                <span className="sr-only"> — {s.state}</span>
                {s.detail && (
                  <span className={`block break-words text-xs ${s.state === 'failed' ? 'text-rose-700 dark:text-rose-300' : 'text-slate-500 dark:text-slate-400'}`}>{s.detail}</span>
                )}
                {s.state === 'running' && s.progress !== undefined && (
                  <span
                    className="mt-1 block h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
                    role="progressbar"
                    aria-label="Deploy progress"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(s.progress * 100)}
                  >
                    <span className="block h-full rounded-full bg-indigo-500 transition-[width]" style={{ width: `${Math.round(s.progress * 100)}%` }} />
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
        {outcome && (
          <p
            role="status"
            className={`rounded-lg px-3 py-2 text-sm ${outcome.ok ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300' : 'bg-rose-500/10 text-rose-800 dark:text-rose-300'}`}
          >
            {outcome.text}
          </p>
        )}
      </div>
    </Modal>
  );
}
