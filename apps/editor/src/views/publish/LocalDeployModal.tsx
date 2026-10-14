import { Check, ExternalLink } from 'lucide-react';
import type { DeployTargetView, Project, Release } from '../../api';
import { Modal } from '../ui/Modal';
import { ProductionSiteLink, deployLinkClass, displayAddress, useProductionUrl, withPreviewToken } from './DeployLinks';

export type LocalDeployState =
  | { kind: 'running' }
  /** `url` is where THIS platform serves the site — null only if no Local Hosting target exists. */
  | { kind: 'done'; release: Release; url: string | null }
  | { kind: 'error'; message: string };

/** Same origin? A production URL that IS the live address is one link, not two. */
function sameSite(a: string, b: string): boolean {
  try {
    const base = window.location.href;
    return new URL(a, base).host === new URL(b, base).host;
  } catch {
    return false;
  }
}

/**
 * A Local Hosting deploy, shown the way a remote deploy is: what is happening, then where it went.
 *
 * It used to end in a toast that said how many pages were published and nothing about where, so the
 * address — the reason for deploying — was one dropdown away. The publish itself stays in PublishBar
 * (a POST that cannot be aborted, which must not be fired twice by a remounting effect); this only
 * shows its state.
 *
 * The live link is the ONE address the site is served at — the primary verified custom domain, else
 * `<slug>.<sites domain>`, else `/sites/<slug>/`; every other host 301s there — carrying the target's
 * preview token when it has one, exactly as View-live does. The production URL is offered as well only
 * when it names a different host.
 */
export function LocalDeployModal({
  project,
  target,
  state,
  previewToken,
  onClose,
}: {
  project: Project;
  target: DeployTargetView;
  state: LocalDeployState;
  previewToken?: string;
  onClose: () => void;
}) {
  const production = useProductionUrl(project.id);
  const done = state.kind === 'done' ? state : null;
  const showProduction = production.loaded && !(done?.url && production.siteUrl && sameSite(production.siteUrl, done.url));

  return (
    <Modal title={`Deploy to ${target.name}`} size="md" onClose={onClose}>
      <div className="space-y-4 p-5">
        <p className="text-xs text-slate-500 dark:text-slate-400">Building the site and serving it from this platform.</p>

        {/* ONE status region for the whole run, present from the start: a live region that is inserted
            already filled is skipped by some screen readers, so running → done must be a CHANGE inside
            it. The toast this replaces was announced; focus stays on the Close button. */}
        <div role="status">
          {state.kind === 'running' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <span className="loading loading-spinner loading-sm text-indigo-600 dark:text-indigo-400" aria-hidden />
                Building and publishing…
              </div>
              <progress className="progress progress-primary w-full" aria-label="Deploy progress" />
            </div>
          )}

          {done && (
            <div className="space-y-3">
              <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                <Check className="h-4 w-4" aria-hidden />
                Published to Local Hosting · {done.release.routes} page{done.release.routes === 1 ? '' : 's'}
              </p>
              {done.url && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <a href={withPreviewToken(done.url, previewToken)} target="_blank" rel="noreferrer" className={deployLinkClass}>
                    Open live site <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </a>
                  <span className="break-all font-mono text-xs text-slate-500 dark:text-slate-400">{displayAddress(done.url)}</span>
                </div>
              )}
              {showProduction && <ProductionSiteLink siteUrl={production.siteUrl} />}
            </div>
          )}

          {state.kind === 'error' && (
            <div role="alert" className="rounded-lg border border-rose-300 dark:border-rose-500/20 bg-rose-50 dark:bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">
              <p className="font-medium">{state.message}</p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
