import { useEffect, useMemo, useState } from 'react';
import type { Page } from '@sitewright/schema';
import { extractEditRegions } from '@sitewright/core';
import { api, previewDocUrl, type Project } from '../api';
import { PreviewPane } from './editor/PreviewPane';

interface ClientSourceEditorProps {
  project: Project;
  page: Page;
  onClose: () => void;
}

const PREVIEW_DEBOUNCE_MS = 400;

/**
 * The constrained client (member) editor for a CODE-FIRST (`source`) page. The developer
 * marked editable regions in the template with `{{edit "key" "default"}}`; this surfaces ONLY
 * those regions as content fields — the template source is never editable here. Saving PUTs
 * the page with an updated `content` map; the server independently enforces that only
 * `content` changed (assertClientEditAllowed), so the template/structure stay immutable.
 */
export function ClientSourceEditor({ project, page, onClose }: ClientSourceEditorProps) {
  const regions = useMemo(() => extractEditRegions(page.source ?? ''), [page.source]);
  const [content, setContent] = useState<Record<string, string>>({ ...(page.content ?? {}) });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ src: string; loading: boolean; error: string | null }>({
    src: '',
    loading: true,
    error: null,
  });

  const draft: Page = useMemo(() => ({ ...page, content }), [page, content]);

  // Debounced, sandboxed server-side preview — `/preview` renders this source page (with the
  // in-progress content) through the isolated worker, served under its own sandbox CSP.
  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      setPreview((prev) => ({ ...prev, loading: true }));
      api
        .preview(project.id, draft)
        .then((res) => {
          if (!cancelled) {
            setPreview({ src: previewDocUrl(project.id, res.token), loading: false, error: null });
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setPreview((prev) => ({
              ...prev,
              loading: false,
              error: err instanceof Error ? err.message : 'preview failed',
            }));
          }
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [project.id, draft]);

  function valueFor(key: string, def: string): string {
    return Object.prototype.hasOwnProperty.call(content, key) ? content[key]! : def;
  }
  function changeRegion(key: string, value: string) {
    setContent((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    if (regions.length === 0) return; // nothing editable — match the disabled-button state
    setSaving(true);
    setError(null);
    try {
      await api.putPage(project.id, draft);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto flex h-[calc(100vh-3.25rem)] max-w-7xl flex-col px-4 py-3">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <button
          aria-label="Back to project"
          className="text-sm text-slate-500 hover:text-slate-900"
          onClick={onClose}
        >
          ← {project.name}
        </button>
        <span className="font-medium">{page.title}</span>
        <span className="text-xs text-slate-400">{page.path}</span>
        <span className="rounded bg-indigo-100 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
          Client editor
        </span>
        <button
          onClick={save}
          disabled={saving || regions.length === 0}
          className="ml-auto rounded-md bg-slate-900 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

      <div className="flex min-h-0 flex-1 gap-4">
        {/* Left: only the developer-marked editable regions */}
        <section className="flex w-1/2 min-w-0 flex-col gap-3 overflow-auto pr-1">
          {regions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
              This page has no editable regions yet. Ask your developer to mark the text you
              should be able to edit with <code>{'{{edit "…"}}'}</code>.
            </div>
          ) : (
            regions.map((region) => (
              <label key={region.key} className="block rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {region.key}
                </span>
                <textarea
                  aria-label={region.key}
                  className="w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-sm"
                  rows={2}
                  value={valueFor(region.key, region.default)}
                  onChange={(e) => changeRegion(region.key, e.target.value)}
                />
              </label>
            ))
          )}
        </section>

        {/* Right: live preview of the whole page with the edits applied */}
        <section className="w-1/2 min-w-0">
          <PreviewPane src={preview.src} loading={preview.loading} error={preview.error} />
        </section>
      </div>
    </main>
  );
}
