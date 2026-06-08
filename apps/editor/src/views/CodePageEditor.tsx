import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Page, Template } from '@sitewright/schema';
import { extractRegions, GLOBAL_TEMPLATES, isGlobalTemplate } from '@sitewright/core';
import { api, previewDocUrl, type Project } from '../api';
import { CodeEditor } from '../lib/code-editor';
import { PreviewPane } from './editor/PreviewPane';
import { RichRegionPanel } from './editor/RichRegionPanel';
import { DevicePreview, PREVIEW_DEVICES, type PreviewDeviceKey } from './editor/DevicePreview';
import { Modal } from './ui/Modal';
import { Tooltip } from './ui/Tooltip';
import { PageSettingsModal, applyPageSettings, pageSettingsFromPage, type PageSettingsValues } from './PageSettingsModal';
import { useDialogs } from './ui/Dialogs';
import { glassInput, glassPanel, primaryButton } from '../theme';

export type EditMode = 'source' | 'content';

interface CodePageEditorProps {
  project: Project;
  page: Page;
  /** All project pages — feeds the settings modal's Parent Page selector. */
  pages?: readonly Page[];
  /** The project's configured locales — feeds the settings modal's Language selector. */
  locales?: readonly string[];
  onClose: () => void;
  /**
   * The mode the modal OPENS in (owners default to `source`, clients to `content`).
   * Source⇄content is a UI default, not a gate — the in-modal toggle switches
   * LOSSLESSLY (both drafts live in this one component; nothing unmounts).
   */
  initialMode?: EditMode;
}

const PREVIEW_DEBOUNCE_MS = 800;

/** Prototype-pollution-significant keys — never accepted as a region key from the preview frame. */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Device-rail glyphs (lucide-style outlines, matching the platform icon vocabulary). */
const DEVICE_ICONS: Record<PreviewDeviceKey, ReactNode> = {
  desktop: (
    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8m-4-4v4" />
    </svg>
  ),
  laptop: (
    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v11H4Z" />
      <path d="M2 19h20" />
    </svg>
  ),
  tablet: (
    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M12 18h.01" />
    </svg>
  ),
  mobile: (
    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <path d="M12 18h.01" />
    </svg>
  ),
};

/** Settings gear — matches the pages-list row glyph; opens the stacked Page settings modal. */
function SettingsIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v3m0 16v3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M1 12h3m16 0h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </svg>
  );
}

/**
 * THE page editor, contentbase-style: a near-fullscreen modal (90vh, blurred
 * backdrop over the page list) with TWO ROWS — an authoring strip on top,
 * COLLAPSED until hovered/focused, and the live styled preview filling the rest,
 * with a device rail simulating the default Tailwind breakpoints.
 *
 * BOTH edit modes live here: `source` (the full Handlebars/CodeMirror editor)
 * and `content` (only the developer-marked `{{edit}}` regions — the safe client
 * surface). The toggle flips the strip in place; drafts survive the switch and
 * one Save persists source + settings + content together.
 *
 * TEMPLATE pages (page.template set): the code surface is LOCKED — the page
 * renders the referenced template's source and contributes only its {{edit}}
 * content. "Fork template into page" copies the template source into the page
 * and drops the reference, re-enabling code mode.
 *
 * Page settings live in their OWN stacked modal (Esc unwinds one modal at a time).
 *
 * Keyboard contract (via the global Modal): ⌘/Ctrl+S saves WITHOUT closing; Esc
 * (or the header ×) goes back to the page list, confirming first when dirty.
 *
 * The preview posts the FULL draft page to `/preview` — skeleton slots, website
 * head/critical CSS, template resolution, and draft {{edit}} content all render,
 * in a sandboxed iframe (`src` from the token endpoint under `CSP: sandbox`;
 * never srcDoc) that can't reach the editor's window/cookies/session.
 */
export function CodePageEditor({ project, page, pages = [], locales = [], onClose, initialMode = 'source' }: CodePageEditorProps) {
  const { confirm, dialog } = useDialogs();
  const [mode, setMode] = useState<EditMode>(initialMode);
  const [source, setSource] = useState(page.source ?? '');
  // The client-editable region values ({{edit "key"}} / data-sw-text overrides) — content mode's draft.
  const [content, setContent] = useState<Record<string, string>>({ ...(page.content ?? {}) });
  // Rich (sanitized-HTML) region values (data-sw-html overrides) — content mode's rich draft.
  const [richContent, setRichContent] = useState<Record<string, string>>({ ...(page.richContent ?? {}) });
  // The rich region currently open in the side editor (its key), or null when none is open.
  const [richOpen, setRichOpen] = useState<string | null>(null);
  // ALL page settings (title/path/status/nav/parent/template/seo) — edited via the
  // stacked PageSettingsModal, applied to this draft, persisted on Save.
  const [settings, setSettings] = useState<PageSettingsValues>(() => pageSettingsFromPage(page));
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Project templates: feed the settings selector, the lock-panel name, and fork.
  const [templates, setTemplates] = useState<Template[]>([]);
  // The sandboxed preview is loaded by URL (token endpoint), not inlined as srcDoc.
  const [previewSrc, setPreviewSrc] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Responsive simulation — large desktop (fluid, the modal's full width) is the default.
  const [device, setDevice] = useState<PreviewDeviceKey>('desktop');
  // The authoring strip opens COLLAPSED; it expands while hovered OR focused (so typing
  // keeps it open when the pointer wanders, and keyboard users get it via Tab).
  const [stripHover, setStripHover] = useState(false);
  const [stripFocus, setStripFocus] = useState(false);
  const stripExpanded = stripHover || stripFocus;

  // The referenced template (when any): global from the built-in list, else project.
  const activeTemplate: Template | undefined = settings.template
    ? isGlobalTemplate(settings.template)
      ? GLOBAL_TEMPLATES.find((t) => t.id === settings.template)
      : templates.find((t) => t.id === settings.template)
    : undefined;

  // The draft page exactly as Save would persist it (and as the preview renders it).
  const draft: Page = useMemo(
    () => ({ ...applyPageSettings(page, settings), source, content, richContent }),
    [page, settings, source, content, richContent],
  );
  // One key over every editable field (BOTH modes + settings) → dirty + post-save snapshot.
  const stateKey = JSON.stringify({ source, content, richContent, settings });
  const [savedKey, setSavedKey] = useState(stateKey);
  const dirty = stateKey !== savedKey;

  // The editable regions come from the EFFECTIVE source: the referenced template's
  // (when set) else the page's own draft — so content mode always reflects reality.
  const regions = useMemo(
    () => extractRegions(settings.template ? (activeTemplate?.source ?? '') : source),
    [settings.template, activeTemplate, source],
  );

  // Guards async setState after the editor is closed (the modal unmounts when another page
  // is opened) — the debounced preview, template fetch, and save can resolve post-unmount.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The preview iframe (the editor↔preview postMessage bridge addresses its contentWindow).
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // The preview's last-reported scroll position — restored on the next reload via a `#sw-y=` hash so
  // a debounced re-render (or a reload after an edit) doesn't jump the preview back to the top.
  const scrollYRef = useRef(0);
  // When a change originates from INLINE-editing the preview, holds the stateKey it produces so the
  // debounced reload skips it (the iframe DOM already shows it — a reload would kill the edit).
  const inlineKeyRef = useRef<string | null>(null);
  // Live mirrors so the mount-scoped message listener computes the post-edit stateKey from fresh state.
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const contentRef = useRef(content);
  contentRef.current = content;
  const richContentRef = useRef(richContent);
  richContentRef.current = richContent;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // Only trust messages from OUR preview frame, tagged by the bridge (opaque cross-origin doc).
      if (e.source !== iframeRef.current?.contentWindow) return;
      const d = e.data as { source?: string; type?: string; y?: number; key?: string; value?: string } | null;
      if (!d || d.source !== 'sitewright-preview') return;
      if (d.type === 'scroll' && typeof d.y === 'number') {
        scrollYRef.current = d.y;
      } else if (d.type === 'edit' && typeof d.key === 'string' && typeof d.value === 'string' && !DANGEROUS_KEYS.has(d.key)) {
        // Inline preview edit → update the matching region (two-way with its side field), and record
        // the resulting stateKey so the debounced reload skips it (keeps the same key order as stateKey).
        const nextContent = { ...contentRef.current, [d.key]: d.value };
        inlineKeyRef.current = JSON.stringify({
          source: sourceRef.current,
          content: nextContent,
          richContent: richContentRef.current,
          settings: settingsRef.current,
        });
        setContent(nextContent);
      } else if (d.type === 'ready') {
        // A freshly-(re)loaded preview → (re)apply the current edit mode so its regions stay editable.
        iframeRef.current?.contentWindow?.postMessage({ source: 'sitewright-editor', type: 'setMode', mode: modeRef.current }, '*');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  // Push edit-mode toggles to the live preview without a reload.
  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage({ source: 'sitewright-editor', type: 'setMode', mode }, '*');
  }, [mode]);

  // Project templates load once per open (small list; powers selector + lock + fork).
  useEffect(() => {
    void api
      .listTemplates(project.id)
      .then((res) => {
        if (mounted.current) setTemplates(res.items);
      })
      .catch(() => {
        /* template-less projects render fine; the selector just shows globals */
      });
  }, [project.id]);

  // Any change to ANY field clears a prior "Saved" flag uniformly — including an undo
  // back to the saved value. A save leaves `stateKey` unchanged (only `savedKey` advances).
  useEffect(() => {
    setSaved(false);
  }, [stateKey]);

  /** Copies the referenced template's source INTO the page and drops the reference. */
  function forkTemplate() {
    if (!activeTemplate) return;
    setSource(activeTemplate.source);
    setSettings((prev) => ({ ...prev, template: '' }));
  }

  function regionValue(key: string, def: string): string {
    return Object.prototype.hasOwnProperty.call(content, key) ? content[key]! : def;
  }
  function changeRegion(key: string, value: string) {
    setContent((prev) => ({ ...prev, [key]: value }));
  }
  function richValue(key: string, def: string): string {
    return Object.prototype.hasOwnProperty.call(richContent, key) ? richContent[key]! : def;
  }
  function changeRichRegion(key: string, html: string) {
    setRichContent((prev) => ({ ...prev, [key]: html }));
  }

  // Debounced full-parity preview: POST the whole draft to `/preview` — skeleton
  // slots, website head/CSS, template resolution, and in-progress {{edit}} content
  // all render, WYSIWYG with publish.
  useEffect(() => {
    // The inline-edit suppression token is valid ONLY while we're still on that exact edited state.
    // The instant the state diverges, drop it — so it can never wrongly suppress a LATER reload whose
    // stateKey happens to equal it again (e.g. a side-field edit-then-revert).
    if (stateKey !== inlineKeyRef.current) inlineKeyRef.current = null;
    // An empty page (no own code, no template) needs no round-trip.
    if (source.trim() === '' && !settings.template) {
      setPreviewSrc('');
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      // Skip the reload when THIS exact state came from inline-editing the preview — the iframe DOM
      // already shows it, so a reload would only kill the live contenteditable mid-edit.
      if (stateKey === inlineKeyRef.current) {
        inlineKeyRef.current = null;
        setPreviewLoading(false);
        return;
      }
      // Set loading INSIDE the timeout (not synchronously) so it tracks the actual
      // in-flight request and is reset by the cleanup below.
      setPreviewLoading(true);
      void api
        .preview(project.id, draft)
        .then(({ token }) => {
          if (cancelled) return;
          // The endpoint always returns a token; the `|| ''` guards an API regression
          // (PreviewPane then loads about:blank). Load the doc under its own sandbox CSP, carrying
          // the last scroll position in a `#sw-y=` fragment (fragments aren't sent to the server)
          // so the freshly-loaded doc's bridge restores it instead of jumping to the top.
          setPreviewSrc(
            token ? previewDocUrl(project.id, token) + (scrollYRef.current ? `#sw-y=${scrollYRef.current}` : '') : '',
          );
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
      // Clear loading if a change (or unmount) races an in-flight request, whose guarded
      // .then/.catch will early-return without touching state.
      setPreviewLoading(false);
    };
    // stateKey covers source/content/settings — everything `draft` renders from.
  }, [stateKey, project.id]);

  /** Saves WITHOUT closing — the authoring loop continues (header ✓ and ⌘/Ctrl+S). */
  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      await api.putPage(project.id, draft);
      if (!mounted.current) return;
      setSavedKey(stateKey);
      setSaved(true);
    } catch (err) {
      if (mounted.current) setSaveError(err instanceof Error ? err.message : 'failed to save');
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  /**
   * Esc / header × / backdrop close guard: when dirty, confirm via the stacked discard DIALOG
   * first. Returning false keeps the editor open (the Modal aborts its close before animating
   * out); true lets the Modal play its exit and then call `onClose` (the parent unmounts us).
   */
  async function confirmClose(): Promise<boolean> {
    if (!dirty) return true;
    return confirm({ title: 'Discard changes', message: 'Discard unsaved changes?', confirmLabel: 'Discard' });
  }

  // Source⇄content, IN PLACE: both drafts live in this component, so switching is lossless —
  // no unmount, no discard, no confirm needed. Pinned to the header's LEFT edge.
  const editModeSwitch = (
    <div
      role="group"
      aria-label="Edit mode"
      className="flex items-center rounded-xl border border-white/60 bg-white/50 p-0.5 text-xs font-medium shadow-sm backdrop-blur-xl"
    >
      {(['source', 'content'] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => setMode(m)}
          className={`rounded-lg px-2.5 py-1 capitalize transition ${
            mode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          {m}
        </button>
      ))}
    </div>
  );

  // Centered between the switch and the right-side actions: the page path + status badges.
  const titleExtra = (
    <>
      <span className="hidden truncate text-xs text-slate-400 sm:inline">{settings.path}</span>
      {settings.status === 'draft' && (
        <span className="rounded-lg bg-slate-200/80 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">draft</span>
      )}
      {settings.template && (
        <span className="rounded-lg bg-indigo-100/80 px-1.5 py-0.5 text-[11px] font-medium text-indigo-700">
          template
        </span>
      )}
    </>
  );

  // Right side, just before Save/Close: the save status + the Page-settings gear (source mode only).
  const headerExtra = (
    <>
      {saved && !dirty && <span className="text-xs text-emerald-600">Saved</span>}
      {saveError && <span className="text-xs text-red-600">{saveError}</span>}
      {mode === 'source' && (
        <Tooltip tip="Page settings" side="bottom">
          <button
            type="button"
            aria-label="Page settings"
            aria-expanded={settingsOpen}
            className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
            onClick={() => setSettingsOpen(true)}
          >
            <SettingsIcon />
          </button>
        </Tooltip>
      )}
    </>
  );

  return (
    <Modal
      title={settings.title}
      size="screen"
      onClose={onClose}
      onBeforeClose={confirmClose}
      onSave={() => void save()}
      saving={saving}
      saveDisabled={!dirty}
      headerLeft={editModeSwitch}
      centerTitle
      titleExtra={titleExtra}
      headerExtra={headerExtra}
    >
      <div className="flex h-full flex-col gap-2 bg-slate-100/50 p-2">
        {/* Row 1 — the authoring strip: collapsed on open (a contentbase-style peek),
            expanding while hovered or focused. The strip's CONTENT flips with the mode:
            the CodeMirror source editor (or the template LOCK panel), or the {{edit}}
            region fields. */}
        <section
          aria-label={mode === 'source' ? 'Template source editor' : 'Editable content regions'}
          data-expanded={stripExpanded}
          className={`shrink-0 overflow-hidden rounded-2xl border border-white/50 shadow-xl shadow-slate-900/10 transition-[height] duration-300 ease-out ${
            mode === 'source' && !settings.template ? 'bg-[#0a0a0f]' : 'bg-white/70 backdrop-blur-xl'
          } ${stripExpanded ? 'h-[45vh]' : 'h-36'}`}
          onMouseEnter={() => setStripHover(true)}
          onMouseLeave={() => setStripHover(false)}
          onFocusCapture={() => setStripFocus(true)}
          onBlurCapture={(e) => {
            // Collapse only when focus truly leaves the strip (not editor-internal moves).
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setStripFocus(false);
          }}
        >
          {mode === 'source' ? (
            settings.template ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                <p className="text-sm text-slate-600">
                  This page renders the template{' '}
                  <strong>{activeTemplate?.name ?? settings.template}</strong> — its code lives in the
                  template, and this page contributes only its editable content (see the{' '}
                  <em>content</em> mode).
                </p>
                <button className={primaryButton} onClick={forkTemplate} disabled={!activeTemplate}>
                  Fork template into page
                </button>
                <p className="text-[11px] text-slate-400">
                  Forking copies the template’s code into this page and removes the reference, so you
                  can customize it freely.
                </p>
              </div>
            ) : (
              <CodeEditor value={source} onChange={setSource} ariaLabel="Template source" />
            )
          ) : (
            <div className="flex h-full flex-col gap-3 overflow-auto p-3">
              {regions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300/80 bg-white/40 p-6 text-center text-sm text-slate-500">
                  This page has no editable regions yet. Mark editable text with{' '}
                  <code>{'data-sw-text="…"'}</code> (or <code>{'{{edit "…"}}'}</code>) and rich text with{' '}
                  <code>{'data-sw-html="…"'}</code> in the source.
                </div>
              ) : (
                regions.map((region) =>
                  region.kind === 'rich' ? (
                    <div key={region.key} className={`block shrink-0 p-3 ${glassPanel}`}>
                      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {region.key}
                      </span>
                      <button type="button" onClick={() => setRichOpen(region.key)} className={`w-full ${primaryButton}`}>
                        Edit rich text…
                      </button>
                    </div>
                  ) : (
                    <label key={region.key} className={`block shrink-0 p-3 ${glassPanel}`}>
                      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {region.key}
                      </span>
                      <textarea
                        aria-label={region.key}
                        className={`resize-y ${glassInput}`}
                        rows={2}
                        value={regionValue(region.key, region.default)}
                        onChange={(e) => changeRegion(region.key, e.target.value)}
                      />
                    </label>
                  ),
                )
              )}
            </div>
          )}
        </section>

        {/* Row 2 — the preview, at the simulated device width, with the device rail
            floating on the right edge (contentbase-style). */}
        <div className="relative min-h-0 flex-1">
          <DevicePreview width={PREVIEW_DEVICES.find((d) => d.key === device)!.width}>
            <PreviewPane src={previewSrc} loading={previewLoading} error={previewError} title="Preview" iframeRef={iframeRef} />
          </DevicePreview>
          <div
            role="group"
            aria-label="Preview device"
            className="absolute right-3 top-3 z-10 flex flex-col gap-1 rounded-xl border border-white/60 bg-white/80 p-1 shadow-lg backdrop-blur-xl"
          >
            {PREVIEW_DEVICES.map((d) => (
              <Tooltip key={d.key} tip={d.width === null ? `${d.label} (full width)` : `${d.label} (${d.width}px)`} side="left">
                <button
                  type="button"
                  aria-label={`Preview: ${d.label}`}
                  aria-pressed={device === d.key}
                  onClick={() => setDevice(d.key)}
                  className={`inline-flex cursor-pointer items-center justify-center rounded-lg p-1.5 transition ${
                    device === d.key ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:bg-white hover:text-slate-900'
                  }`}
                >
                  {DEVICE_ICONS[d.key]}
                </button>
              </Tooltip>
            ))}
          </div>
        </div>
      </div>

      {/* The rich-text side editor STACKS above this modal; it edits the shared draft live. */}
      {richOpen && (
        <RichRegionPanel
          regionKey={richOpen}
          value={richValue(richOpen, regions.find((r) => r.key === richOpen)?.default ?? '')}
          onChange={(html) => changeRichRegion(richOpen, html)}
          onClose={() => setRichOpen(null)}
        />
      )}

      {/* Page settings STACK above this modal; applying updates the DRAFT (one Save persists all). */}
      {settingsOpen && (
        <PageSettingsModal
          page={page}
          projectId={project.id}
          initial={settings}
          pages={pages}
          templates={templates}
          locales={locales}
          onClose={() => setSettingsOpen(false)}
          onSubmit={(values) => {
            setSettings(values);
            setSettingsOpen(false);
          }}
        />
      )}
      {dialog}
    </Modal>
  );
}
