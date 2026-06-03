import { useEffect, useState } from 'react';
import { api, type Project, type Release } from '../api';
import { DeployForm } from './publish/DeployForm';

/** Publish + export bar: build the static site, view it, download a zip, or deploy it. */
export function PublishBar({ project }: { project: Project }) {
  const [release, setRelease] = useState<Release | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDeploy, setShowDeploy] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .publishStatus(project.id)
      .then((res) => {
        if (active) {
          setRelease(res.release);
          setUrl(res.url);
        }
      })
      .catch(() => {
        /* no published site yet, or transient — Publish still works */
      });
    return () => {
      active = false;
    };
  }, [project.id]);

  async function publish() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.publish(project.id);
      setRelease(res.release);
      setUrl(res.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'publish failed');
    } finally {
      setBusy(false);
    }
  }

  const published = release !== null;

  return (
    <div className="mb-6 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={publish}
          disabled={busy}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy ? 'Publishing…' : 'Publish'}
        </button>
        {published && url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            aria-label="View published site"
            className="text-sm text-sky-700 underline hover:text-sky-900"
          >
            View site
          </a>
        )}
        {published && (
          <a
            href={api.archiveUrl(project.id)}
            aria-label="Download site zip"
            className="text-sm text-slate-600 underline hover:text-slate-900"
          >
            Download .zip
          </a>
        )}
        {published && (
          <button
            onClick={() => setShowDeploy((s) => !s)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:border-slate-500"
          >
            Deploy…
          </button>
        )}
        {release && <span className="text-xs text-slate-400">{release.routes} pages</span>}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
      {published && showDeploy && <DeployForm project={project} />}
    </div>
  );
}
