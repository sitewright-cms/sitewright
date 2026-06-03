import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NAV_SLOTS, type NavSlot, type Page } from '@sitewright/schema';
import { api, previewDocUrl, type Project } from '../api';
import { CodeEditor } from '../lib/code-editor';
import { CODE_PATTERNS } from '../lib/code-patterns';
import { PreviewPane } from './editor/PreviewPane';
import { glassPanel, glassInput, primaryButton } from '../theme';

interface CodePageEditorProps {
  project: Project;
  page: Page;
  onClose: () => void;
  /** Optional source⇄content switch, rendered in the header (provided by ProjectView). */
  modeToggle?: ReactNode;
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
export function CodePageEditor({ project, page, onClose, modeToggle }: CodePageEditorProps) {
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
        .renderTemplate(project.id, {
          template: source,
          page: { title, path: page.path },
          document: true,
        })
        .then(({ token }) => {
          if (cancelled) return;
          // document:true always returns a token; the `|| ''` is a defensive guard against an API
          // regression (PreviewPane then loads about:blank). Load the doc under its own sandbox CSP.
          setPreviewSrc(token ? previewDocUrl(project.id, token) : '');
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
  }, [source, title, project.id, page.path]);

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      await api.putPage(project.id, { ...page, source, title, status, nav });
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
      <header className={`m-2 mb-0 flex items-center gap-3 px-4 py-2 ${glassPanel}`}>
        <button
          aria-label="Back to pages"
          className="text-sm text-slate-500 hover:text-slate-900"
          onClick={onClose}
        >
          ← Pages
        </button>
        <h2 className="text-sm font-semibold text-slate-800">
          {title} <span className="font-normal text-slate-400">{page.path}</span>
        </h2>
        <span className="rounded-lg bg-slate-800 px-1.5 py-0.5 text-[11px] font-medium text-white">code</span>
        {status === 'draft' && (
          <span className="rounded-lg bg-slate-200/80 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">draft</span>
        )}
        <button
          aria-label="Page settings"
          aria-expanded={showSettings}
          className={`rounded-xl border px-2 py-1 text-sm transition ${
            showSettings ? 'border-indigo-400 bg-white/70 text-slate-900' : 'border-white/60 bg-white/40 text-slate-600 hover:bg-white/70'
          }`}
          onClick={() => setShowSettings((s) => !s)}
        >
          Page settings
        </button>
        <select
          aria-label="Insert pattern"
          className={`${glassInput} w-auto`}
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
          {modeToggle}
          {saved && !dirty && <span className="text-xs text-emerald-600">Saved</span>}
          {saveError && <span className="text-xs text-red-600">{saveError}</span>}
          <button
            className={`${primaryButton} disabled:opacity-40`}
            disabled={saving || !dirty}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </header>
      {showSettings && (
        <div className={`mx-2 mt-2 px-4 py-3 ${glassPanel}`}>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="flex flex-col text-xs font-semibold text-slate-700">
              Title
              <input
                aria-label="Page title"
                className={`mt-1.5 font-normal ${glassInput}`}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <div>
              <p className="mb-1.5 text-xs font-semibold text-slate-700">Status</p>
              <div className="inline-flex rounded-xl border border-white/60 bg-white/40 p-0.5">
                {(['published', 'draft'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={status === s}
                    onClick={() => setStatus(s)}
                    className={`rounded-lg px-3 py-1 text-sm capitalize transition ${
                      status === s ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-white/60'
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
                      className={glassInput}
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
                      className={glassInput}
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
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 p-2">
        {/* The CodeMirror surface stays on its own light background for legibility; only the
            frame around it is frosted. */}
        <div className="min-h-0 overflow-hidden rounded-2xl border border-white/50 bg-white shadow-xl shadow-slate-900/5">
          <CodeEditor value={source} onChange={edit} ariaLabel="Template source" />
        </div>
        <div className="min-h-0">
          <PreviewPane src={previewSrc} loading={previewLoading} error={previewError} title="Preview" />
        </div>
      </div>
    </main>
  );
}
