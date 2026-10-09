import { useEffect, useState } from 'react';
import { api } from '../../../api';

/** Human bytes for the JSON-data readout — the number is what separates "works" from "works and is empty". */
const jsonBytes = (n: number): string => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / (1024 * 1024)).toFixed(2)} MB`);

/**
 * What the preview will actually render for `{{ website.json_data }}`.
 *
 * ★ Worth its own line because BOTH failure modes are invisible in the preview itself: a source that
 * 404s and a source that returns `{}` each render as nothing at all, and until this existed the first
 * signal either way was a publish 409. Re-reads whenever the saved URL changes.
 */
export function JsonDataStatus({ projectId, url }: { projectId: string; url: string }) {
  const [state, setState] = useState<Awaited<ReturnType<typeof api.jsonDataStatus>> | null>(null);
  useEffect(() => {
    if (!url.trim()) {
      setState(null);
      return;
    }
    let active = true;
    // The save warms the cache without blocking its own response, so a just-saved URL can still be in
    // flight — re-ask a few times rather than reporting "waiting" and leaving it there.
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = (): void => {
      api
        .jsonDataStatus(projectId)
        .then((r) => {
          if (!active) return;
          setState(r);
          if (r.awaiting && tries++ < 6) timer = setTimeout(read, 1000);
        })
        .catch(() => {
          /* status is a courtesy — an older instance without the route just shows nothing */
        });
    };
    read();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [projectId, url]);

  if (!state?.configured) return null;
  if (state.awaiting) {
    return <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Reading the source…</p>;
  }
  if (!state.ok) {
    return (
      <p className="mt-1 rounded-lg bg-rose-500/10 px-3 py-2 text-[11px] text-rose-700 dark:text-rose-400">
        Could not read this source: {state.error}. The preview and the published site will render{' '}
        <code>{'{{ website.json_data }}'}</code> empty until it resolves.
      </p>
    );
  }
  if (state.bytes === 0) {
    return (
      <p className="mt-1 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
        Read, but the source is empty — nothing will render.
      </p>
    );
  }
  return (
    <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-400">
      Read {jsonBytes(state.bytes ?? 0)} — available in the preview now.
    </p>
  );
}
