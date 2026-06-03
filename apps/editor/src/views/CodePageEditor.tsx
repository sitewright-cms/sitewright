import { useEffect, useRef, useState } from 'react';
import { NAV_SLOTS, type NavSlot, type Page } from '@sitewright/schema';
import { api, previewDocUrl, type Org, type Project } from '../api';
import { CodeEditor } from '../lib/code-editor';
import { CODE_PATTERNS } from '../lib/code-patterns';
import { PreviewPane } from './editor/PreviewPane';

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
 * a full styled document), stored behind an opaque token, and shown in the shared
 * {@link PreviewPane} via an iframe `src` (NOT `srcDoc`): the token endpoint serves the doc
 * under its own `Content-Security-Policy: sandbox` (an opaque origin), so the preview can never
 * reach the editor's window/cookies/session — defense-in-depth beyond the no-JS validator.
 */
export function CodePageEditor({ org, project, page, onClose }: CodePageEditorProps) {
  const [source, setSource] = useState(page.source ?? '');
  // Page-level settings — a code page is a first-class page, carrying its own title/status/nav.
  const [title, setTitle] = useState(page.title);
  const [status, setStatus] = useState<'draft' | 'published'>(page.status ?? 'published');
  const [navSlots, setNavSlots] = useState<NavSlot[]>(page.nav?.slots ?? []);
  const [navTitle, setNavTitle] = useState(page.nav?.title ?? '');
  const [navOrder, setNavOrder] = useState<number>(page.nav?.order ?? 0);
  const [showSettings, setShowSettings] = useState(false);
  // The sandboxed preview is loaded by URL (token endpoint), not inlined as srcDoc.
  const [previewSrc, setPreviewSrc] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [patternKey, setPatternKey] = useState(''); // controlled value of the "Insert pattern" select

  // The nav object as it will be persisted (undefined = not in any menu).
  const nav = navSlots.length
    ? { slots: navSlots, ...(navTitle ? { title: navTitle } : {}), order: navOrder }
    : undefined;
  // One key over every editable field → dirty + post-save snapshot in one place.
  const stateKey = JSON.stringify({ source, title, status, nav });
  const [savedKey, setSavedKey] = useState(stateKey);
  const dirty = stateKey !== savedKey;

  // Guards async setState after the editor is closed (the view unmounts when another page
  // is opened) — both the debounced preview and the save can resolve post-unmount.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Any change to ANY field (source or a setting) clears a prior "Saved" flag uniformly —
  // including an undo back to the saved value, so the banner doesn't linger or reappear. A
  // save leaves `stateKey` unchanged (only `savedKey` advances), so this doesn't fire then.
  useEffect(() => {
    setSaved(false);
  }, [stateKey]);

  function edit(next: string) {
    setSource(next);
  }

  /** Append a built-in DaisyUI starter pattern to the template (a page is built top-to-bottom). */
  function insertPattern(id: string) {
    const pattern = CODE_PATTERNS.find((p) => p.id === id);
    if (!pattern) return;
    // Functional update → always appends to the latest committed source, never a stale closure.
    setSource((prev) => (prev.trim() ? `${prev.trimEnd()}\n${pattern.source}\n` : `${pattern.source}\n`));
  }

  useEffect(() => {
    // An empty template needs no round-trip — show a blank preview pane immediately.
    if (source.trim() === '') {
      setPreviewSrc('');
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      // Set loading INSIDE the timeout (not synchronously) so it tracks the actual in-flight
      // request — matching ClientSourceEditor — and is reset by the cleanup below.
      setPreviewLoading(true);
      void api
        .renderTemplate(org.id, project.id, {
          template: source,
          page: { title, path: page.path },
          document: true,
        })
        .then(({ token }) => {
          if (cancelled) return;
          // document:true always returns a token; the `|| ''` is a defensive guard against an API
          // regression (PreviewPane then loads about:blank). Load the doc under its own sandbox CSP.
          setPreviewSrc(token ? previewDocUrl(org.id, project.id, token) : '');
          setPreviewError(null);
          setPreviewLoading(false);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setPreviewError(err instanceof Error ? err.message : 'preview failed');
          setPreviewLoading(false);
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
      // Clear loading if a source change (or unmount) races an in-flight request, whose guarded
      // .then/.catch will early-return without touching state.
      setPreviewLoading(false);
    };
  }, [source, title, org.id, project.id, page.path]);

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      await api.putPage(org.id, project.id, { ...page, source, title, status, nav });
      if (!mounted.current) return;
      setSavedKey(stateKey);
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
          {title} <span className="font-normal text-slate-400">{page.path}</span>
        </h2>
        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] font-medium text-white">code</span>
        {status === 'draft' && (
          <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">draft</span>
        )}
        <button
          aria-label="Page settings"
          aria-expanded={showSettings}
          className={`rounded-md border px-2 py-1 text-sm ${
            showSettings ? 'border-slate-900 text-slate-900' : 'border-slate-300 text-slate-600'
          }`}
          onClick={() => setShowSettings((s) => !s)}
        >
          Page settings
        </button>
        <select
          aria-label="Insert pattern"
          className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700"
          value={patternKey}
          onChange={(e) => {
            insertPattern(e.target.value);
            setPatternKey(''); // reset to the placeholder via state (not DOM mutation)
          }}
        >
          <option value="" disabled>
            Insert pattern…
          </option>
          {CODE_PATTERNS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
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
      {showSettings && (
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="flex flex-col text-xs font-semibold text-slate-700">
              Title
              <input
                aria-label="Page title"
                className="mt-1.5 rounded-md border border-slate-300 px-2 py-1 text-sm font-normal"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <div>
              <p className="mb-1.5 text-xs font-semibold text-slate-700">Status</p>
              <div className="inline-flex rounded-md border border-slate-300 p-0.5">
                {(['published', 'draft'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={status === s}
                    onClick={() => setStatus(s)}
                    className={`rounded px-3 py-1 text-sm capitalize ${
                      status === s ? 'bg-slate-900 text-white' : 'text-slate-600'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold text-slate-700">Navigation</p>
              <div className="flex flex-wrap gap-3">
                {NAV_SLOTS.map((slot) => (
                  <label key={slot} className="flex items-center gap-1.5 text-sm capitalize">
                    <input
                      type="checkbox"
                      aria-label={`Nav: ${slot}`}
                      checked={navSlots.includes(slot)}
                      onChange={(e) =>
                        setNavSlots((prev) => (e.target.checked ? [...prev, slot] : prev.filter((x) => x !== slot)))
                      }
                    />
                    {slot}
                  </label>
                ))}
              </div>
              {navSlots.length > 0 && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="flex flex-col text-[11px] text-slate-500">
                    Menu label
                    <input
                      aria-label="Nav menu label"
                      className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                      value={navTitle}
                      placeholder={title}
                      onChange={(e) => setNavTitle(e.target.value)}
                    />
                  </label>
                  <label className="flex flex-col text-[11px] text-slate-500">
                    Order
                    <input
                      aria-label="Nav order"
                      type="number"
                      className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                      value={navOrder}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        if (!Number.isNaN(v)) setNavOrder(v);
                      }}
                    />
                  </label>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-2">
        <div className="min-h-0 border-r border-slate-200">
          <CodeEditor value={source} onChange={edit} ariaLabel="Template source" />
        </div>
        <div className="min-h-0 bg-white p-2">
          <PreviewPane src={previewSrc} loading={previewLoading} error={previewError} />
        </div>
      </div>
    </main>
  );
}
