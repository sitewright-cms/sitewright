import { useEffect, useState } from 'react';
import { X, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { RUNNING_BUILD } from '../buildId';

/**
 * Pull-based version notice. Two cases off ONE `/version` poll:
 *  - `staleBuild`: the DEPLOYED editor bundle differs from this loaded tab's bundle (a redeploy happened) →
 *    a persistent "Reload" bar (this tab's JS is out of date; cache headers only help the NEXT load).
 *  - `update`: a newer self-hosted Sitewright RELEASE exists → the existing dismissible upgrade notice.
 */
export function UpdateBanner() {
  const [info, setInfo] = useState<{ latest: string; url: string | null } | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [staleBuild, setStaleBuild] = useState(false);

  useEffect(() => {
    let active = true;
    const check = (): void => {
      api
        .version()
        .then((v) => {
          if (!active) return;
          // A redeploy changed the served bundle hash while this tab kept its old one → stale tab.
          if (v.build && RUNNING_BUILD !== 'dev' && v.build !== RUNNING_BUILD) setStaleBuild(true);
          if (v.updateAvailable && v.latest) {
            // Defense-in-depth: only ever follow an https link (never trust a URL into an href unchecked).
            const url = v.releaseUrl && v.releaseUrl.startsWith('https://') ? v.releaseUrl : null;
            setInfo({ latest: v.latest, url });
          }
        })
        .catch(() => {
          /* version check is best-effort */
        });
    };
    check();
    // Re-check when the user returns to the tab (the common "I deployed, switch back" moment).
    window.addEventListener('focus', check);
    return () => {
      active = false;
      window.removeEventListener('focus', check);
    };
  }, []);

  // The stale-tab reload bar takes precedence (this tab's code is out of date).
  if (staleBuild) {
    return (
      <div className="flex items-center justify-center gap-3 border-b border-indigo-200/70 bg-indigo-100/80 px-4 py-2 text-sm text-indigo-900 backdrop-blur-xl">
        <span>A new version of the editor is available.</span>
        <button
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Reload
        </button>
      </div>
    );
  }

  if (!info || dismissed) return null;

  return (
    <div className="flex items-center justify-center gap-3 border-b border-amber-200/60 bg-amber-100/70 px-4 py-2 text-sm text-amber-900 backdrop-blur-xl">
      <span>
        A new Sitewright release ({info.latest}) is available.{' '}
        {info.url && (
          <a href={info.url} target="_blank" rel="noreferrer" className="font-bold underline">
            View release
          </a>
        )}
      </span>
      <button
        aria-label="Dismiss update notice"
        className="rounded px-1 text-amber-700 hover:text-amber-950"
        onClick={() => setDismissed(true)}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
