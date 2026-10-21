import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import type { SiteRegistrationEntry, SiteRegistrationView } from '@sitewright/schema';
import { api } from '../../../api';

/**
 * Whether the site is registered with the PLATFORM's Google and Bing accounts — agency staff only, under the
 * Production URL it is registered by. Registration itself needs no button: every publish and deploy does it.
 */

const ENGINES = [
  { key: 'google', name: 'Google Search Console' },
  { key: 'bing', name: 'Bing Webmaster Tools' },
] as const;

/** A registration runs after the publish answers: while one is waiting, look again a few times. */
const RECHECK_MS = 3000;
const RECHECKS = 10;

const day = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

function Line({ name, entry }: { name: string; entry: SiteRegistrationEntry }) {
  if (entry.status === 'verified') {
    return (
      <li className="flex items-start gap-1.5 text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          {name}: verified{entry.verifiedAt ? ` on ${day(entry.verifiedAt)}` : ''}
        </span>
      </li>
    );
  }
  if (entry.status === 'failed') {
    return (
      <li className="flex items-start gap-1.5 text-rose-700 dark:text-rose-400">
        <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          {name}: not registered. {entry.detail ?? 'The search engine refused.'} The next publish or deploy tries again.
        </span>
      </li>
    );
  }
  return (
    <li className="flex items-start gap-1.5 text-slate-500 dark:text-slate-400">
      <Clock className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        {name}: {entry.status === 'pending' ? 'waiting for it to confirm the published tag' : 'registers at the next publish or deploy'}
      </span>
    </li>
  );
}

export function SearchEngineStatus({ projectId, siteUrl }: { projectId: string; siteUrl: string }) {
  const [view, setView] = useState<SiteRegistrationView | null>(null);
  useEffect(() => {
    let active = true;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = (): void => {
      api
        .getSiteRegistration(projectId)
        .then((v) => {
          if (!active) return;
          setView(v);
          if ((v.google.status === 'pending' || v.bing.status === 'pending') && tries++ < RECHECKS) timer = setTimeout(read, RECHECK_MS);
        })
        .catch(() => {
          /* a courtesy line: no answer (not staff, an older instance) shows nothing */
        });
    };
    read();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
    // The saved URL is what is registered; re-read when the field changes so a save shows its effect.
  }, [projectId, siteUrl]);

  const engines = view ? ENGINES.filter((e) => view[e.key].configured) : [];
  if (!view || engines.length === 0) return null;
  if (!view.siteUrl) {
    return (
      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
        {view.notice === 'not-https' ? 'Only an https Production URL' : 'A Production URL'} is registered with the platform’s Google and Bing
        accounts.
      </p>
    );
  }
  return (
    <ul className="mt-1 flex flex-col gap-0.5 text-[11px]" aria-label="Search engine registration">
      {engines.map((e) => (
        <Line key={e.key} name={e.name} entry={view[e.key]} />
      ))}
    </ul>
  );
}
