import { useEffect, useRef, useState } from 'react';
import type { Page } from '@sitewright/schema';
import { api, type Org, type Project } from '../api';
import { CodeEditor } from '../lib/code-editor';

interface CodePageEditorProps {
  org: Org;
  project: Project;
  page: Page;
  onClose: () => void;
}

const PREVIEW_DEBOUNCE_MS = 500;

/**
 * The code-first authoring loop: write a page's Handlebars `source` (HTML + Tailwind) on
 * the left, see a live STYLED preview on the right, and save it back to `page.source`.
 *
 * The preview renders the current source in the isolated worker pool (`document: true` →
 * a full styled document) and shows it in a `sandbox`ed iframe — no scripts run (the
 * validator forbids tenant JS and the empty sandbox blocks execution besides), while the
 * editor's `style-src 'unsafe-inline'` lets the inlined Tailwind paint.
 */
export function CodePageEditor({ org, project, page, onClose }: CodePageEditorProps) {
  const [source, setSource] = useState(page.source ?? '');
  const [savedSource, setSavedSource] = useState(page.source ?? '');
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = source !== savedSource;

  // Guards async setState after the editor is closed (the view unmounts when another page
  // is opened) — both the debounced preview and the save can resolve post-unmount.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Any edit clears a prior "Saved" flag (including an undo back to the saved value, so the
  // banner doesn't linger or reappear).
  function edit(next: string) {
    setSource(next);
    setSaved(false);
  }

  useEffect(() => {
    // An empty template needs no round-trip — show a blank preview pane immediately.
    if (source.trim() === '') {
      setPreviewHtml('');
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      void api
        .renderTemplate(org.id, project.id, {
          template: source,
          page: { title: page.title, path: page.path },
          document: true,
        })
        .then(({ html }) => {
          if (cancelled) return;
          setPreviewHtml(html);
          setPreviewError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setPreviewError(err instanceof Error ? err.message : 'preview failed');
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [source, org.id, project.id, page.title, page.path]);

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      await api.putPage(org.id, project.id, { ...page, source });
      if (!mounted.current) return;
      setSavedSource(source);
      setSaved(true);
    } catch (err) {
      if (mounted.current) setSaveError(err instanceof Error ? err.message : 'failed to save');
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <main className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-2">
        <button
          aria-label="Back to pages"
          className="text-sm text-slate-500 hover:text-slate-900"
          onClick={onClose}
        >
          ← Pages
        </button>
        <h2 className="text-sm font-semibold">
          {page.title} <span className="font-normal text-slate-400">{page.path}</span>
        </h2>
        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] font-medium text-white">code</span>
        <div className="ml-auto flex items-center gap-3">
          {saved && !dirty && <span className="text-xs text-emerald-600">Saved</span>}
          {saveError && <span className="text-xs text-red-600">{saveError}</span>}
          <button
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
            disabled={saving || !dirty}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-2">
        <div className="min-h-0 border-r border-slate-200">
          <CodeEditor value={source} onChange={edit} ariaLabel="Template source" />
        </div>
        <div className="relative min-h-0 bg-white">
          {previewError && (
            <div
              role="alert"
              className="absolute inset-x-0 top-0 z-10 max-h-32 overflow-auto whitespace-pre-wrap bg-red-50 px-3 py-2 font-mono text-xs text-red-700"
            >
              {previewError}
            </div>
          )}
          <iframe title="Preview" srcDoc={previewHtml} sandbox="" className="h-full w-full border-0" />
        </div>
      </div>
    </main>
  );
}
