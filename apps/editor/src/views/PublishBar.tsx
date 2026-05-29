import { useEffect, useState } from 'react';
import { api, type Org, type Project, type Release } from '../api';

/** Publish control: builds the static site and links to the live result. */
export function PublishBar({ org, project }: { org: Org; project: Project }) {
  const [release, setRelease] = useState<Release | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .publishStatus(org.id, project.id)
      .then((res) => {
        if (active) {
          setRelease(res.release);
          setUrl(res.url);
        }
      })
      .catch(() => {
        /* no published site yet, or transient — the Publish button still works */
      });
    return () => {
      active = false;
    };
  }, [org.id, project.id]);

  async function publish() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.publish(org.id, project.id);
      setRelease(res.release);
      setUrl(res.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'publish failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {release && url && (
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
      {release && <span className="text-xs text-slate-400">{release.routes} pages</span>}
      <button
        onClick={publish}
        disabled={busy}
        className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {busy ? 'Publishing…' : 'Publish'}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
