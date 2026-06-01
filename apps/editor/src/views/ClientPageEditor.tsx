import { useEffect, useMemo, useState } from 'react';
import type { Page, PageNode } from '@sitewright/schema';
import { descriptorFor } from '@sitewright/blocks';
import { api, previewDocUrl, type Org, type Project } from '../api';
import { collectEditableNodes } from '../lib/editable-nodes';
import { setProps } from '../lib/tree-ops';
import { PropsForm } from './editor/PropsForm';
import { PreviewPane } from './editor/PreviewPane';

interface ClientPageEditorProps {
  org: Org;
  project: Project;
  page: Page;
  onClose: () => void;
}

const PREVIEW_DEBOUNCE_MS = 400;

/**
 * The constrained client (member) editor. It surfaces ONLY the content fields of
 * nodes a developer flagged `editable` — no block palette, no tree, no page settings,
 * no structural controls. The member changes copy and sees it live; saving PUTs the
 * page back, where the server independently enforces that only editable-node props
 * changed (assertClientEditAllowed). Structure and page settings are immutable here.
 */
export function ClientPageEditor({ org, project, page, onClose }: ClientPageEditorProps) {
  const [root, setRoot] = useState<PageNode>(page.root);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ src: string; loading: boolean; error: string | null }>({
    src: '',
    loading: true,
    error: null,
  });

  const editables = useMemo(() => collectEditableNodes(root), [root]);
  const draft: Page = useMemo(() => ({ ...page, root }), [page, root]);

  // Same debounced server-side preview as the full editor.
  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      setPreview((prev) => ({ ...prev, loading: true }));
      api
        .preview(org.id, project.id, draft)
        .then((res) => {
          if (!cancelled) {
            setPreview({ src: previewDocUrl(org.id, project.id, res.token), loading: false, error: null });
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
  }, [org.id, project.id, draft]);

  function changeProp(id: string, key: string, value: unknown) {
    setRoot((prev) => setProps(prev, id, { [key]: value }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.putPage(org.id, project.id, draft);
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
          disabled={saving || editables.length === 0}
          className="ml-auto rounded-md bg-slate-900 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

      <div className="flex min-h-0 flex-1 gap-4">
        {/* Left: only the editable regions' content fields */}
        <section className="flex w-1/2 min-w-0 flex-col gap-3 overflow-auto pr-1">
          {editables.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
              This page has no editable regions yet. Ask your developer to mark the blocks
              you should be able to edit.
            </div>
          ) : (
            editables.map((node, i) => (
              <div key={node.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {descriptorFor(node.type)?.label ?? node.type}
                  <span className="ml-2 font-normal normal-case text-slate-300">#{i + 1}</span>
                </h3>
                <PropsForm node={node} onChange={(key, value) => changeProp(node.id, key, value)} />
              </div>
            ))
          )}
        </section>

        {/* Right: live preview of the whole page */}
        <section className="w-1/2 min-w-0">
          <PreviewPane src={preview.src} loading={preview.loading} error={preview.error} />
        </section>
      </div>
    </main>
  );
}
