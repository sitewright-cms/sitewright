import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { Settings, RotateCcw, History } from 'lucide-react';
import type { JsonValue, Page, Template } from '@sitewright/schema';
import {
  GLOBAL_TEMPLATES,
  GLOBAL_TEMPLATE_PREFIX,
  isGlobalTemplate,
  codeOwnerOf,
  resolveCodeRef,
  resolveTemplateSource,
  pagesById,
  pagePath,
} from '@sitewright/core';
import { safeUrl } from '@sitewright/blocks/url';
import { classifyControlTarget, normalizeControlAs } from '@sitewright/blocks/control';
import { api, previewDocUrl, type Project } from '../api';
import { useCiPalette } from '../lib/ci-palette';
import { CodeEditor, type CodeEditorHandle } from '../lib/code-editor';
import { parseTemplateErrorPosition } from '../lib/template-error';
import { PreviewPane } from './editor/PreviewPane';
import { DevicePreview, PREVIEW_DEVICES, type PreviewDeviceKey } from './editor/DevicePreview';
import { HtmlSourceModal } from './editor/HtmlSourceModal';
import { Modal } from './ui/Modal';
import { Tooltip } from './ui/Tooltip';
import { PageSettingsModal, applyPageSettings, pageSettingsFromPage, type PageSettingsValues } from './PageSettingsModal';
import { useDialogs } from './ui/Dialogs';
import { FilePicker } from './files/FilePicker';
import { ACCEPT } from './files/FileBrowser';
import { EntryEditorLoader } from './datasets/EntryEditorLoader';
import { RegionsPanel, type RegionItem } from './code/RegionsPanel';
import { RevisionHistoryModal } from './RevisionHistoryModal';
import { WebsiteDataModal } from './settings/WebsiteDataModal';
import {
  DANGEROUS_KEYS,
  isSafeKey,
  mergeDefaults,
  pageDataGet,
  pageDataObject,
  pageDataSet,
} from '../lib/page-data';
import { primaryButton, gradientSurface } from '../theme';
import { PageAuditPanel } from './pagespeed/PageAuditPanel';

export type EditMode = 'source' | 'content' | 'audit';

/** Human label for a mode-switcher tab (the enum values stay `source`/`content`/`audit`). */
function editModeLabel(mode: EditMode): string {
  return mode === 'content' ? 'Content Editor' : mode === 'audit' ? 'Page Audit' : 'Code Editor';
}

/** A valid translation-catalog key — a flat identifier OR a dotted scope path; mirrors @sitewright/schema
 *  TranslationKeySchema. Guards the inline write before the PUT (a scoped data-sw-translate key like
 *  `home.headline` must pass, or the inline edit is silently dropped). */
function isTranslationKey(key: string): boolean {
  // eslint-disable-next-line security/detect-unsafe-regex -- linear (dot-separated segments), length-capped — see TranslationKeySchema
  return key.length <= 128 && /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(key) && !DANGEROUS_KEYS.has(key);
}

interface CodePageEditorProps {
  project: Project;
  page: Page;
  /** All project pages — feeds the settings modal's Parent Page selector. */
  pages?: readonly Page[];
  /** The project's configured locales (default first) — feeds the stacked Page Settings modal (its
   *  create-mode "Available in" scope) and the inline-translate write-locale. */
  locales?: readonly string[];
  onClose: () => void;
  /** Open ANOTHER page's editor (the parent swaps which page is being edited → this modal remounts
   *  for the target page). Used when the user clicks an internal link in the preview. */
  onNavigate?: (pageId: string) => void;
  /**
   * The mode the modal OPENS in. The pages list opens this in `content` for everyone (the
   * Content Editor — the live preview); `source` is the bare fallback. Source⇄content is a UI
   * default, not a gate — the in-modal toggle switches LOSSLESSLY (both drafts live in this one
   * component; nothing unmounts).
   */
  initialMode?: EditMode;
}

const PREVIEW_DEBOUNCE_MS = 800;

// The page.data routing/merge helpers (page.data.<path> keys, immutable leaf get/set, template-default
// merge, proto-guards) + DANGEROUS_KEYS live in ../lib/page-data so they can be unit-tested directly.

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

/**
 * THE page editor, contentbase-style: a near-fullscreen modal (90vh, blurred
 * backdrop over the page list) with the live styled preview filling it, plus —
 * in the Code Editor (source mode) ONLY — an authoring strip on top, COLLAPSED
 * until hovered/focused. A device rail simulates the default Tailwind breakpoints.
 *
 * BOTH edit modes live here: `source` (the full Handlebars/CodeMirror editor) and
 * `content` (the live preview, where the developer-marked `data-sw-*` directives —
 * data-sw-text/html/href/src/bg — are edited in place: the safe client surface).
 * It opens in `content` by default; the toggle flips in place; drafts survive the
 * switch and one Save persists source + settings + content together.
 *
 * TEMPLATE pages (page.template set): the code surface is LOCKED — the page
 * renders the referenced template's source and contributes only its `data-sw-*`
 * content. "Fork template into page" copies the template source into the page
 * and drops the reference, re-enabling code mode.
 *
 * Page settings live in their OWN stacked modal (Esc unwinds one modal at a time).
 *
 * Keyboard contract (via the global Modal): ⌘/Ctrl+S saves WITHOUT closing; Esc
 * (or the header ×) goes back to the page list, confirming first when dirty.
 *
 * The preview posts the FULL draft page to `/preview` — skeleton slots, website
 * head/critical CSS, template resolution, and draft `data-sw-*` content all render,
 * in a sandboxed iframe (`src` from the token endpoint under `CSP: sandbox`;
 * never srcDoc) that can't reach the editor's window/cookies/session.
 */
export function CodePageEditor({ project, page, pages = [], locales = [], onClose, onNavigate, initialMode = 'source' }: CodePageEditorProps) {
  const { confirm, dialog } = useDialogs();
  const [mode, setMode] = useState<EditMode>(initialMode);
  const [source, setSource] = useState(page.source ?? '');
  // Per-page data → the SINGLE editable store: ALL data-sw-* leaves (text/html/href/src/bg) live here
  // as page.data, plus {{ page.data.* }} structured data. Edited in-preview (the directives) and via
  // the "Edit page data" tree/JSON modal.
  const [pageData, setPageData] = useState<JsonValue>(page.data ?? {});
  const [pageDataOpen, setPageDataOpen] = useState(false);
  // The content key whose image is being replaced via the file picker (data-sw-src/bg click), or null.
  const [pickerKey, setPickerKey] = useState<string | null>(null);
  // The {{sw-control}} target whose asset is being picked (as="image" → images, as="file" → files), or null.
  const [controlPick, setControlPick] = useState<{ target: string; as: 'image' | 'file' } | null>(null);
  // True while the rich-text toolbar's "insert image" media picker is open; the pick is posted back to the
  // bridge (insert-media) which inserts the <img> at the saved caret inside the data-sw-html region.
  const [mediaInsert, setMediaInsert] = useState(false);
  // The dataset entry being edited from a preview click (data-sw-entry), or null.
  const [openEntry, setOpenEntry] = useState<{ dataset: string; id: string } | null>(null);
  // The editable-regions manifest the preview bridge posts in content mode (drives the Regions rail).
  const [regions, setRegions] = useState<RegionItem[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  // The data-sw-html region being edited in the source modal (toolbar </> button): its key + the HTML to
  // seed (the stored page.data override if any, else the live authored default), or null when closed.
  const [htmlSource, setHtmlSource] = useState<{ key: string; html: string } | null>(null);
  // Bumped to force a preview reload after a dataset entry is saved (the preview renders from saved
  // entries server-side, so the draft is unchanged — only a re-POST picks up the new values).
  const [previewNonce, setPreviewNonce] = useState(0);
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
  // Source-mode (CodeMirror) undo/redo — the editor reports its own history availability, and the
  // toolbar drives it through this handle (distinct from the page.data inline-edit history below).
  const codeRef = useRef<CodeEditorHandle>(null);
  const [srcCanUndo, setSrcCanUndo] = useState(false);
  const [srcCanRedo, setSrcCanRedo] = useState(false);
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

  // INHERIT mode: a translated page (non-default locale) with no own source and no template
  // follows its main-language owner's code. Its preview + content regions come from the
  // owner's resolved source (the server inherits it too); fork or assign a template (Page
  // settings → Code source) to give this language its own code.
  const defaultLocale = locales[0] ?? 'en';
  const codeOwner = codeOwnerOf(page, pages, defaultLocale);
  const inheritsCode = !source.trim() && !settings.template && !!codeOwner && codeOwner.id !== page.id;
  const inheritedSource = useMemo(() => {
    if (!inheritsCode || !codeOwner) return '';
    const ref = resolveCodeRef(codeOwner, pages, defaultLocale);
    if (ref.source) return ref.source;
    if (ref.template) {
      const projMap = new Map(templates.map((t) => [t.id, t]));
      const globalMap = new Map(GLOBAL_TEMPLATES.map((t) => [GLOBAL_TEMPLATE_PREFIX + t.id, t]));
      try {
        return resolveTemplateSource(ref.template, projMap, globalMap);
      } catch {
        return '';
      }
    }
    return '';
  }, [inheritsCode, codeOwner, pages, defaultLocale, templates]);

  // The draft page exactly as Save would persist it (and as the preview renders it). An empty
  // page.data ({}/[]/null) is dropped so a never-touched page stays minimal — `data: undefined` is
  // omitted on PUT (an empty root carries no addressable value; same rule as website.data). NOTE:
  // `draft.data` is the empty-OMITTED value (sent to the server, never read back into `pageData`),
  // whereas `stateKey`/`inlineToken`/the undo Snapshot all track the RAW `pageData` — they only need
  // to agree with EACH OTHER for dirty/suppress/undo to work, which they do.
  const draft: Page = useMemo(
    () => ({ ...applyPageSettings(page, settings), source, data: pageDataObject(pageData) }),
    [page, settings, source, pageData],
  );
  // One key over every editable field (BOTH modes + settings) → dirty + post-save snapshot.
  const keyOf = (s: string, st: PageSettingsValues, d: JsonValue) => JSON.stringify({ source: s, settings: st, data: d });
  const stateKey = keyOf(source, settings, pageData);
  const [savedKey, setSavedKey] = useState(stateKey);
  const dirty = stateKey !== savedKey;

  // A rejected SAVE (validate-on-save) carries the offending line/column in its message — surface it
  // as a gutter marker in the source editor. We use the SAVE error (not the live preview error):
  // validate-on-save checks THIS page's own source, so the position is always in the editor's text,
  // whereas a preview error can originate in an included snippet/template.
  const editorError = useMemo(() => {
    const pos = parseTemplateErrorPosition(saveError);
    return pos && saveError ? { ...pos, message: saveError } : null;
  }, [saveError]);

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
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const pageDataRef = useRef(pageData);
  pageDataRef.current = pageData;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  // The project's CI rich-text palette (brand colours + font slots) — posted to the preview bridge so the
  // on-page `data-sw-html` toolbar offers the SAME brand colours/fonts as the dataset richtext toolbar. Held
  // in a ref so the mount-scoped message handler (empty deps) reads the latest without re-subscribing.
  const ci = useCiPalette();
  const ciRef = useRef(ci);
  ciRef.current = ci;
  // Set by the website.data queue below; declared here so applyControlEdit can route to it (its body runs
  // at message time, after the assignment). Avoids a use-before-define on the queue function.
  const queueWebsiteDataRef = useRef<(key: string, value: string) => void>(() => {});
  // Apply a {{sw-control}} edit: route a whitelisted target to page settings (title / SEO), per-page
  // page.data, or the GLOBAL website.data. Body is stale-safe (functional setState + pure helpers / refs),
  // so the message handler reaches it via a ref.
  function applyControlEdit(target: string, as: string | undefined, value: string): void {
    const t = classifyControlTarget(target);
    if (!t) return;
    // Normalize `as` (it arrives raw from the iframe postMessage) so the URL-sanitize gate is symmetric.
    const a = normalizeControlAs(as);
    // `page.image` is a URL field regardless of the `as` hint, so scheme-sanitize it too.
    const v = a === 'image' || a === 'file' || a === 'url' || (t.kind === 'page' && t.field === 'image') ? safeUrl(value, '') : value;
    // A page field maps 1:1 onto the flat settings form values (title / description / image).
    if (t.kind === 'page') {
      const field = t.field;
      setSettings((s) =>
        field === 'title'
          ? { ...s, title: v }
          : field === 'description'
            ? { ...s, description: v }
            : { ...s, image: v },
      );
    } else if (t.kind === 'website') {
      // GLOBAL store: a website.data leaf → saved to the settings entity (debounced, like translations),
      // independent of the page Save. v is already safeUrl'd above for image/file/url controls.
      queueWebsiteDataRef.current(t.key, v);
    } else setPageData((prev) => pageDataSet(prev, t.key, v));
  }
  const applyControlEditRef = useRef(applyControlEdit);
  applyControlEditRef.current = applyControlEdit;
  // A click on an internal site link in the preview → open THAT page's editor. Resolve the clicked
  // route to a page (full path via pagePath), warn (naming the page change) if there are unsaved
  // edits, then ask the parent to switch. Unknown routes / a link to the page already open → no-op.
  async function onPreviewLinkClick(href: string): Promise<void> {
    if (!onNavigate) return;
    const path = (href.split(/[?#]/)[0] ?? '').replace(/\/+$/, '') || '/';
    const byId = pagesById(pages);
    const target = pages.find((p) => ((pagePath(p, byId).replace(/\/+$/, '') || '/') === path));
    if (!target || target.id === page.id) return;
    if (
      dirty &&
      !(await confirm({
        title: 'Leave this page?',
        message: `You have unsaved changes on “${page.title}”. Discard them and open the editor for “${target.title}”?`,
        confirmLabel: 'Discard & open',
      }))
    )
      return;
    onNavigate(target.id);
  }
  const onLinkClickRef = useRef(onPreviewLinkClick);
  onLinkClickRef.current = onPreviewLinkClick;
  // The stateKey a given inline (preview-originated) edit will produce — stored in inlineKeyRef so
  // the debounced reload can skip it. MUST mirror `stateKey`'s field set + order exactly.
  function inlineToken(next: { data?: JsonValue }): string {
    return JSON.stringify({
      source: sourceRef.current,
      settings: settingsRef.current,
      data: next.data ?? pageDataRef.current,
    });
  }
  // --- Inline TRANSLATION edits (data-sw-translate) → website.translations[key][writeLocale]. Unlike the
  //     page.data directives these write the SHARED project catalog, so they auto-save immediately
  //     (debounced to coalesce typing) via their own endpoint, independent of the page Save button. The
  //     preview DOM already shows the edit (contenteditable) and a translate edit touches no page state,
  //     so no reload fires. writeLocale = this page's locale (a default-language page writes defaultLocale). ---
  // The cell an inline data-sw-translate edit writes: this page's locale, else the project default
  // (defaultLocale is derived above from locales[0]; a default-language page has page.locale undefined).
  const writeLocale = page.locale ?? defaultLocale;
  const pendingTrRef = useRef(new Map<string, { key: string; locale: string; value: string }>());
  const trTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  async function flushTranslations(): Promise<void> {
    trTimerRef.current = null;
    const cells = [...pendingTrRef.current.values()];
    pendingTrRef.current.clear();
    for (const c of cells) {
      try {
        await api.setTranslation(project.id, c.key, c.locale, c.value);
      } catch (err) {
        if (mounted.current) setSaveError(err instanceof Error ? `Translation not saved: ${err.message}` : 'Translation not saved');
      }
    }
  }
  function queueTranslation(key: string, value: string): void {
    // Keyed by translation key — every edit on this page targets the same writeLocale, so one entry per
    // key coalesces a burst of keystrokes into a single PUT.
    pendingTrRef.current.set(key, { key, locale: writeLocale, value });
    if (trTimerRef.current) clearTimeout(trTimerRef.current);
    trTimerRef.current = setTimeout(() => void flushTranslations(), 600);
  }
  const queueTranslationRef = useRef(queueTranslation);
  queueTranslationRef.current = queueTranslation;
  // Flush a pending translation edit if the editor closes inside the debounce window (fire-and-forget).
  useEffect(
    () => () => {
      if (!trTimerRef.current) return;
      clearTimeout(trTimerRef.current);
      for (const c of pendingTrRef.current.values()) void api.setTranslation(project.id, c.key, c.locale, c.value).catch(() => {});
      pendingTrRef.current.clear();
    },
    [],
  );
  // --- Inline {{sw-control target="website.data.<path>"}} edits → the GLOBAL website.data store. Like
  //     translations these auto-save (debounced) to the settings entity via their own endpoint, NOT the
  //     page Save. website.data isn't part of the editor's draft state, so after a save we bump
  //     previewNonce to re-POST /preview (the slot/page reading {{website.data.*}} shows the new value). ---
  const pendingWdRef = useRef(new Map<string, { key: string; value: string }>());
  const wdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  async function flushWebsiteData(): Promise<void> {
    wdTimerRef.current = null;
    const cells = [...pendingWdRef.current.values()];
    pendingWdRef.current.clear();
    let saved = false;
    for (const c of cells) {
      try {
        await api.setWebsiteData(project.id, c.key, c.value);
        saved = true;
      } catch (err) {
        if (mounted.current) setSaveError(err instanceof Error ? `Website data not saved: ${err.message}` : 'Website data not saved');
      }
    }
    if (saved && mounted.current) setPreviewNonce((n) => n + 1);
  }
  function queueWebsiteData(key: string, value: string): void {
    pendingWdRef.current.set(key, { key, value });
    if (wdTimerRef.current) clearTimeout(wdTimerRef.current);
    wdTimerRef.current = setTimeout(() => void flushWebsiteData(), 600);
  }
  queueWebsiteDataRef.current = queueWebsiteData;
  useEffect(
    () => () => {
      if (!wdTimerRef.current) return;
      clearTimeout(wdTimerRef.current);
      for (const c of pendingWdRef.current.values()) void api.setWebsiteData(project.id, c.key, c.value).catch(() => {});
      pendingWdRef.current.clear();
    },
    [],
  );
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // Only trust messages from OUR preview frame, tagged by the bridge (opaque cross-origin doc).
      if (e.source !== iframeRef.current?.contentWindow) return;
      const d = e.data as {
        source?: string;
        type?: string;
        y?: number;
        key?: string;
        value?: string;
        html?: string;
        hrefKey?: string;
        href?: string;
        textKey?: string;
        text?: string;
        target?: string;
        as?: string;
        kind?: 'image' | 'bg'; // pick-image: the click origin; both currently use the image picker
        dataset?: string;
        id?: string;
        items?: RegionItem[]; // 'regions' manifest from the bridge
      } | null;
      if (!d || d.source !== 'sitewright-preview') return;
      if (d.type === 'scroll' && typeof d.y === 'number') {
        scrollYRef.current = d.y;
      } else if (d.type === 'edit' && typeof d.key === 'string' && typeof d.value === 'string' && isSafeKey(d.key)) {
        // Inline plain-text edit → write the page.data leaf (bare key → top-level prop; page.data.<path> →
        // nested). The iframe DOM already shows it, so suppress the reload.
        const nextData = pageDataSet(pageDataRef.current, d.key, d.value);
        inlineKeyRef.current = inlineToken({ data: nextData });
        setPageData(nextData);
      } else if (d.type === 'translate-edit' && typeof d.key === 'string' && typeof d.value === 'string' && isTranslationKey(d.key)) {
        // Inline TRANSLATION edit → write the SHARED project catalog (website.translations[key][writeLocale]),
        // auto-saved (debounced) on its own endpoint. The contenteditable already shows it; no reload needed.
        queueTranslationRef.current(d.key, d.value);
      } else if (d.type === 'rich-edit' && typeof d.key === 'string' && typeof d.html === 'string' && isSafeKey(d.key)) {
        // Inline RICH edit → write the page.data leaf (bare key → top-level prop; page.data.<path> → nested),
        // the SAME single store as every other directive. The raw iframe HTML is stored as-is; it is
        // sanitized at RENDER (the html sink runs sanitizeRichHtml on each /preview + publish), so the
        // draft value is never executed. Suppress the reload (the rich contenteditable already shows it).
        const nextData = pageDataSet(pageDataRef.current, d.key, d.html);
        inlineKeyRef.current = inlineToken({ data: nextData });
        setPageData(nextData);
      } else if (d.type === 'link-edit' && typeof d.hrefKey === 'string' && d.hrefKey !== '' && typeof d.href === 'string' && isSafeKey(d.hrefKey)) {
        // Inline link edit (URL + optional text) → page.data leaves. The popover did NOT change the
        // iframe DOM, so we do NOT suppress — the debounced reload re-renders the anchor. Scheme-sanitize
        // the URL here too (the render also safeUrl's it). The functional updaters chain so both writes
        // land atomically.
        const safeHref = safeUrl(d.href, '');
        const hk = d.hrefKey;
        setPageData((prev) => pageDataSet(prev, hk, safeHref));
        if (typeof d.textKey === 'string' && d.textKey !== '' && typeof d.text === 'string' && isSafeKey(d.textKey)) {
          const tk = d.textKey;
          const txt = d.text;
          setPageData((prev) => pageDataSet(prev, tk, txt));
        }
      } else if (d.type === 'edit-html-source' && typeof d.key === 'string' && d.key !== '' && isSafeKey(d.key)) {
        // Clicked the rich-text toolbar's </> button → open the HTML source editor for that region. Seed
        // with the stored page.data override if present, else the live authored default (bridge innerHTML).
        const stored = pageDataGet(pageDataRef.current, d.key);
        setHtmlSource({ key: d.key, html: typeof stored === 'string' ? stored : typeof d.html === 'string' ? d.html : '' });
      } else if (d.type === 'control-edit' && typeof d.target === 'string' && classifyControlTarget(d.target) && typeof d.value === 'string') {
        // {{sw-control}} set a value → write the target (page setting / page.data); the preview reloads.
        applyControlEditRef.current(d.target, d.as, d.value);
      } else if (d.type === 'control-pick-image' && typeof d.target === 'string' && classifyControlTarget(d.target)) {
        // {{sw-control}} as="image"/"file" → open the file picker (filtered by `as`); the pick writes the target.
        setControlPick({ target: d.target, as: d.as === 'file' ? 'file' : 'image' });
      } else if (d.type === 'pick-image' && typeof d.key === 'string' && d.key !== '' && isSafeKey(d.key)) {
        // Clicked an editable image/background in the preview → open the file picker for that region.
        setPickerKey(d.key);
      } else if (d.type === 'pick-media') {
        // The rich-text toolbar's "insert image" button → open the media picker; the pick is posted back as
        // 'insert-media' and the bridge inserts the <img> at its saved caret. No key: it's a free insertion.
        setMediaInsert(true);
      } else if (
        d.type === 'open-entry' &&
        typeof d.dataset === 'string' &&
        d.dataset !== '' &&
        typeof d.id === 'string' &&
        d.id !== '' &&
        !DANGEROUS_KEYS.has(d.dataset) &&
        !DANGEROUS_KEYS.has(d.id)
      ) {
        // Clicked a rendered dataset row in the preview → open that entry's editor.
        setOpenEntry({ dataset: d.dataset, id: d.id });
      } else if (d.type === 'regions' && Array.isArray(d.items)) {
        // The bridge enumerated every editable region (content mode) → drive the Regions rail. Empty on
        // leaving content mode. The items are validated structurally before any action (edit-region only
        // sends back a numeric rid; open-entry/control-edit are re-validated by their own handlers).
        setRegions(
          d.items.filter(
            (r) => r && Number.isInteger(r.rid) && typeof r.kind === 'string' && typeof r.label === 'string',
          ),
        );
      } else if (d.type === 'link-click' && typeof d.href === 'string') {
        // Clicked an internal site link in the preview → switch the editor to that page (via the ref so
        // this mount-scoped listener sees fresh pages/dirty/onNavigate).
        void onLinkClickRef.current(d.href);
      } else if (d.type === 'ready') {
        // A freshly-(re)loaded preview → clear the stale manifest (the new doc re-posts it on entering
        // content mode below) and (re)apply the current edit mode so its regions stay editable.
        setRegions([]);
        const win = iframeRef.current?.contentWindow;
        win?.postMessage({ source: 'sitewright-editor', type: 'setMode', mode: modeRef.current }, '*');
        // Seed the fresh doc's rich-text toolbar with the project's CI palette (brand colours + font slots).
        win?.postMessage({ source: 'sitewright-editor', type: 'ci-palette', colors: ciRef.current.colors, fonts: ciRef.current.fonts }, '*');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  // Push edit-mode toggles to the live preview without a reload. 'audit' is not a preview mode (the
  // preview iframe is unmounted while the Page Audit tab is shown), so it's never sent to the bridge.
  useEffect(() => {
    if (mode === 'audit') return;
    iframeRef.current?.contentWindow?.postMessage({ source: 'sitewright-editor', type: 'setMode', mode }, '*');
  }, [mode]);
  // Push the CI palette when it loads (identity is fetched async by the parent, so it may resolve AFTER the
  // preview already reported 'ready'). `ci` is memoised per-identity by the provider, so this fires only when
  // the brand actually changes — not every render.
  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { source: 'sitewright-editor', type: 'ci-palette', colors: ci.colors, fonts: ci.fonts },
      '*',
    );
  }, [ci]);

  // --- Undo/redo for INLINE edits (page.data: plain text, rich, image, link). Source is owned by
  //     CodeMirror's own history; settings by the settings modal. A history of snapshots; a debounced
  //     push coalesces typing, a fresh edit truncates the redo tail. ---
  type Snapshot = { data: JsonValue };
  const MAX_HISTORY = 100; // bound the per-session memory of a long editing run
  const historyRef = useRef<Snapshot[]>([{ data: page.data ?? {} }]);
  const histIdxRef = useRef(0);
  // Set true around an undo/redo restore so the resulting setState(s) — batched into one render —
  // don't get recorded back as a new history entry. Cleared on the single effect run that follows.
  const applyingHistory = useRef(false);
  const [, bumpHist] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (applyingHistory.current) {
      applyingHistory.current = false;
      return;
    }
    // Leading edge: a fresh edit immediately invalidates any redo tail.
    if (histIdxRef.current < historyRef.current.length - 1) {
      historyRef.current = historyRef.current.slice(0, histIdxRef.current + 1);
      bumpHist();
    }
    const snap: Snapshot = { data: pageData };
    const t = setTimeout(() => {
      const cur = historyRef.current[histIdxRef.current];
      if (cur && JSON.stringify(cur) === JSON.stringify(snap)) return; // no real change to record
      // Append, then cap from the front (keeping the index pinned to the newest entry).
      const next = [...historyRef.current.slice(0, histIdxRef.current + 1), snap].slice(-MAX_HISTORY);
      historyRef.current = next;
      histIdxRef.current = next.length - 1;
      bumpHist();
    }, 400);
    return () => clearTimeout(t);
  }, [pageData]);
  const canUndo = histIdxRef.current > 0;
  const canRedo = histIdxRef.current < historyRef.current.length - 1;
  function applySnapshot(s: Snapshot) {
    applyingHistory.current = true;
    setPageData(s.data);
    bumpHist();
  }
  function undo() {
    if (histIdxRef.current > 0) {
      histIdxRef.current -= 1;
      applySnapshot(historyRef.current[histIdxRef.current]!);
    }
  }
  function redo() {
    if (histIdxRef.current < historyRef.current.length - 1) {
      histIdxRef.current += 1;
      applySnapshot(historyRef.current[histIdxRef.current]!);
    }
  }
  // ⌘/Ctrl+Z (⇧ for redo) — but never while a text field, contenteditable, or CodeMirror is focused
  // (they own their native undo). Only the editor "chrome" (preview/side buttons) routes here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable || ae.closest('.cm-editor'))) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
  // Also drop a stale save error (and its source gutter marker): once the author edits, the
  // old line/column no longer points at anything meaningful — the live preview re-surfaces a
  // still-present error.
  useEffect(() => {
    setSaved(false);
    setSaveError(null);
  }, [stateKey]);

  /** Copies the referenced template's source AND its declared default data INTO the page, then drops
   *  the reference — so the page can customize both the code and its page.data per-page. */
  function forkTemplate() {
    if (!activeTemplate) return;
    setSource(activeTemplate.source);
    if (activeTemplate.data !== undefined) setPageData((prev) => mergeDefaults(prev, activeTemplate.data as JsonValue));
    setSettings((prev) => ({ ...prev, template: '' }));
  }

  /** Fork an INHERIT-mode translation: copy the main language's resolved layout into this page so
   *  this language gets its own editable code (the page stops following the owner). */
  function forkInherited() {
    if (inheritedSource) setSource(inheritedSource);
  }

  /** Applies the settings modal's result; when a template is newly ENABLED, seed page.data with its
   *  declared defaults (fill-missing — never clobber the author's existing values). */
  function applySettings(values: PageSettingsValues) {
    if (values.template && values.template !== settings.template) {
      const tpl = isGlobalTemplate(values.template)
        ? GLOBAL_TEMPLATES.find((t) => t.id === values.template)
        : templates.find((t) => t.id === values.template);
      if (tpl?.data !== undefined) setPageData((prev) => mergeDefaults(prev, tpl.data as JsonValue));
    }
    setSettings(values);
  }

  // Writes a text/url region (the in-preview file picker uses this for images) into page.data —
  // a bare key → top-level prop; a `page.data.<path>` key → nested.
  function changeRegion(key: string, value: string) {
    setPageData((prev) => pageDataSet(prev, key, value));
  }

  // Debounced full-parity preview: POST the whole draft to `/preview` — skeleton
  // slots, website head/CSS, template resolution, and in-progress {{edit}} content
  // all render, WYSIWYG with publish.
  useEffect(() => {
    // The inline-edit suppression token is valid ONLY while we're still on that exact edited state.
    // The instant the state diverges, drop it — so it can never wrongly suppress a LATER reload whose
    // stateKey happens to equal it again (e.g. a side-field edit-then-revert).
    if (stateKey !== inlineKeyRef.current) inlineKeyRef.current = null;
    // An empty page (no own code, no template) needs no round-trip — UNLESS it inherits its
    // code from the main language, in which case the server resolves the owner's layout.
    if (source.trim() === '' && !settings.template && !inheritsCode) {
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
            token ? previewDocUrl(project.slug, token) + (scrollYRef.current ? `#sw-y=${scrollYRef.current}` : '') : '',
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
    // stateKey covers source/content/settings — everything `draft` renders from; previewNonce forces
    // a re-POST after a dataset entry save (entries are fetched server-side, so the draft is unchanged).
  }, [stateKey, project.id, previewNonce]);

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

  /** Re-fetch this page from the server, DISCARDING the in-memory draft (source + page.data +
   *  settings) and resetting the dirty baseline + inline-edit history. Gated by a dirty-warning
   *  confirm in {@link onReloadClick}. */
  async function reload() {
    setSaveError(null);
    try {
      const fresh = (await api.getPage(project.id, page.id)).item;
      if (!mounted.current) return;
      const freshData = (fresh.data ?? {}) as JsonValue;
      const freshSettings = pageSettingsFromPage(fresh);
      // Reset the inline-edit history to the reloaded data (don't record the reset itself).
      historyRef.current = [{ data: freshData }];
      histIdxRef.current = 0;
      applyingHistory.current = true;
      setSource(fresh.source ?? '');
      setPageData(freshData);
      setSettings(freshSettings);
      setSavedKey(keyOf(fresh.source ?? '', freshSettings, freshData)); // baseline = reloaded → not dirty
      setSaved(false);
      // ALWAYS force a fresh preview render: when the page wasn't dirty (or the server copy matches the
      // draft) `stateKey` doesn't change, so the stateKey-driven preview effect wouldn't re-run and the
      // button would appear to do nothing. Bumping the nonce re-POSTs `/preview`, so Reload reliably
      // refreshes — and also picks up changes made OUTSIDE this page (dataset entries, website.data).
      setPreviewNonce((n) => n + 1);
    } catch (err) {
      if (mounted.current) setSaveError(err instanceof Error ? `Reload failed: ${err.message}` : 'Reload failed');
    }
  }

  /** Reload click: warn before discarding unsaved edits. */
  async function onReloadClick() {
    if (dirty && !(await confirm({ title: 'Reload page', message: 'Discard unsaved changes and reload this page from the server?', confirmLabel: 'Discard & reload' }))) return;
    await reload();
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
      className="flex items-center rounded-xl border border-white/60 dark:border-white/10 bg-white/50 dark:bg-white/5 p-0.5 text-xs font-medium shadow-sm backdrop-blur-xl"
    >
      {(['source', 'content', 'audit'] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => setMode(m)}
          className={`waves-effect rounded-lg px-2.5 py-1 transition ${
            mode === m ? `${gradientSurface} font-bold` : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100'
          }`}
        >
          {editModeLabel(m)}
        </button>
      ))}
    </div>
  );

  // Centered between the switch and the right-side actions: the page path + status badges.
  const titleExtra = (
    <>
      <span className="hidden truncate text-xs text-slate-400 dark:text-slate-500 sm:inline">{settings.path}</span>
      {settings.status === 'draft' && (
        <span className="rounded-lg bg-slate-200/80 dark:bg-white/10 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-300">draft</span>
      )}
      {settings.template && (
        <span className="rounded-lg bg-indigo-100/80 dark:bg-indigo-500/15 px-1.5 py-0.5 text-[11px] font-medium text-indigo-700 dark:text-indigo-400">
          template
        </span>
      )}
    </>
  );

  // Right side, just before Save/Close: the save status + the Page-settings gear (source mode only).
  const toolBtnClass =
    'inline-flex cursor-pointer items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 text-slate-500 dark:text-slate-400 transition hover:border-slate-300 dark:hover:border-slate-600 hover:text-slate-900 dark:hover:text-slate-100 disabled:cursor-default disabled:opacity-40';
  // Undo/redo target the ACTIVE editor: CodeMirror's history in source mode, the page.data inline-edit
  // history in content mode — so the SAME two buttons work consistently in both modes.
  const activeCanUndo = mode === 'source' ? srcCanUndo : canUndo;
  const activeCanRedo = mode === 'source' ? srcCanRedo : canRedo;
  const doUndo = () => (mode === 'source' ? codeRef.current?.undo() : undo());
  const doRedo = () => (mode === 'source' ? codeRef.current?.redo() : redo());
  // BOTH modes share ONE toolbar: Undo · Redo · Page data · Page settings · Reload (+ the Modal's Save/Close).
  const headerExtra = (
    <>
      {saved && !dirty && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>}
      {saveError && <span className="text-xs text-red-600 dark:text-red-400">{saveError}</span>}
      <Tooltip tip="Undo (Ctrl+Z)" side="bottom">
        <button type="button" aria-label="Undo" disabled={!activeCanUndo} onClick={doUndo} className={toolBtnClass}>
          <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 14 4 9l5-5" />
            <path d="M4 9h11a5 5 0 0 1 0 10h-1" />
          </svg>
        </button>
      </Tooltip>
      <Tooltip tip="Redo (Ctrl+Shift+Z)" side="bottom">
        <button type="button" aria-label="Redo" disabled={!activeCanRedo} onClick={doRedo} className={toolBtnClass}>
          <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 14 5-5-5-5" />
            <path d="M20 9H9a5 5 0 0 0 0 10h1" />
          </svg>
        </button>
      </Tooltip>
      <Tooltip tip="Edit page data" side="bottom">
        <button type="button" aria-label="Edit page data" aria-expanded={pageDataOpen} className={toolBtnClass} onClick={() => setPageDataOpen(true)}>
          <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1" />
            <path d="M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1" />
          </svg>
        </button>
      </Tooltip>
      <Tooltip tip="Page settings" side="bottom">
        <button type="button" aria-label="Page settings" aria-expanded={settingsOpen} className={toolBtnClass} onClick={() => setSettingsOpen(true)}>
          <Settings className="h-5 w-5" />
        </button>
      </Tooltip>
      <Tooltip tip="Reload from the server (discards unsaved changes)" side="bottom">
        <button type="button" aria-label="Reload page" className={toolBtnClass} onClick={() => void onReloadClick()}>
          <RotateCcw className="h-5 w-5" />
        </button>
      </Tooltip>
      <Tooltip tip="Revision history" side="bottom">
        <button type="button" aria-label="Revision history" className={toolBtnClass} onClick={() => setHistoryOpen(true)}>
          <History className="h-5 w-5" />
        </button>
      </Tooltip>
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
      <div className="flex h-full flex-col gap-2 bg-slate-100/50 dark:bg-white/5 p-2">
        {/* Row 1 — the authoring strip (SOURCE MODE ONLY): the CodeMirror source editor, or the
            template / inherited-code LOCK panel. Collapsed on open (a contentbase-style peek),
            expanding while hovered or focused. CONTENT mode hides this strip entirely so the live
            preview fills the modal — every editable element is marked in the preview itself. */}
        {mode === 'source' && (
          <section
            aria-label="Template source editor"
            data-expanded={stripExpanded}
            className={`shrink-0 overflow-hidden rounded-2xl border border-white/50 dark:border-white/10 shadow-xl shadow-slate-900/10 transition-[height] duration-300 ease-out ${
              !settings.template ? 'bg-[#0a0a0f]' : 'bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl'
            } ${stripExpanded ? 'h-[45vh]' : 'h-36'}`}
            onMouseEnter={() => setStripHover(true)}
            onMouseLeave={() => setStripHover(false)}
            onFocusCapture={() => setStripFocus(true)}
            onBlurCapture={(e) => {
              // Collapse only when focus truly leaves the strip (not editor-internal moves).
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setStripFocus(false);
            }}
          >
            {settings.template ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  This page renders the template{' '}
                  <strong>{activeTemplate?.name ?? settings.template}</strong> — its code lives in the
                  template, and this page contributes only its editable content (see the{' '}
                  <em>Content Editor</em>).
                </p>
                <button className={primaryButton} onClick={forkTemplate} disabled={!activeTemplate}>
                  Fork template into page
                </button>
                <p className="text-[11px] text-slate-400 dark:text-slate-500">
                  Forking copies the template’s code into this page and removes the reference, so you
                  can customize it freely.
                </p>
              </div>
            ) : inheritsCode ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  This page inherits its layout from the main language
                  {codeOwner ? <> (<strong>{codeOwner.title}</strong>)</> : null}. Change the structure
                  for every language by editing the main page — here you translate the text (see the{' '}
                  <em>Content Editor</em>).
                </p>
                <button className={primaryButton} onClick={forkInherited} disabled={!inheritedSource}>
                  Fork the code for this language
                </button>
                <p className="text-[11px] text-slate-400 dark:text-slate-500">
                  Forking copies the current layout into this language so you can customize it
                  independently of the others.
                </p>
              </div>
            ) : (
              <CodeEditor
                ref={codeRef}
                value={source}
                onChange={setSource}
                ariaLabel="Template source"
                error={editorError}
                onHistory={(u, r) => {
                  setSrcCanUndo(u);
                  setSrcCanRedo(r);
                }}
              />
            )}
          </section>
        )}

        {/* Row 2 — the preview (source/content) and the Page Audit tab. BOTH stay MOUNTED, toggled with
            `hidden`, so returning to the preview never reloads the iframe and a run's audit result +
            device choice survive leaving/returning to the Page Audit tab. */}
        <div className={`relative min-h-0 flex-1 ${mode === 'audit' ? 'hidden' : ''}`}>
          <DevicePreview width={PREVIEW_DEVICES.find((d) => d.key === device)!.width}>
            <PreviewPane src={previewSrc} loading={previewLoading} error={previewError} title="Preview" iframeRef={iframeRef} />
          </DevicePreview>
          <div
            role="group"
            aria-label="Preview device"
            className="absolute right-3 top-3 z-10 flex flex-col gap-1 rounded-xl border border-white/60 dark:border-white/10 bg-white/80 dark:bg-slate-900/80 p-1 shadow-lg backdrop-blur-xl"
          >
            {PREVIEW_DEVICES.map((d) => (
              <Tooltip key={d.key} tip={d.width === null ? `${d.label} (full width)` : `${d.label} (${d.width}px)`} side="left">
                <button
                  type="button"
                  aria-label={`Preview: ${d.label}`}
                  aria-pressed={device === d.key}
                  onClick={() => setDevice(d.key)}
                  className={`inline-flex cursor-pointer items-center justify-center rounded-lg p-1.5 transition ${
                    device === d.key ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:bg-white dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {DEVICE_ICONS[d.key]}
                </button>
              </Tooltip>
            ))}
          </div>
        </div>
        <div className={mode === 'audit' ? 'flex min-h-0 flex-1' : 'hidden'}>
          <PageAuditPanel
            projectId={project.id}
            pageId={page.id}
            auditable={!page.collection}
            dirty={dirty}
            seo={{ title: settings.title, path: settings.path, description: settings.description ?? '', image: settings.image ?? '' }}
          />
        </div>
      </div>

      {/* Raw-HTML editor for a rich (data-sw-html) region: opened by the toolbar's </> button. Saving
          writes the leaf into the draft; the preview then reloads to reflect it (no suppression). */}
      {htmlSource && (
        <HtmlSourceModal
          swKey={htmlSource.key}
          value={htmlSource.html}
          onSave={(html) => {
            setPageData((prev) => pageDataSet(prev, htmlSource.key, html));
            setHtmlSource(null);
          }}
          onClose={() => setHtmlSource(null)}
        />
      )}

      {/* Image/background replacement: clicking a data-sw-src/bg region in the preview opens this. */}
      {pickerKey && (
        <FilePicker
          projectId={project.id}
          accept={ACCEPT.image}
          title="Replace image"
          onPick={(url) => {
            // Scheme-sanitize at store time too (the render also safeUrl's) — canonical-clean content.
            changeRegion(pickerKey, safeUrl(url, ''));
            setPickerKey(null);
          }}
          onClose={() => setPickerKey(null)}
        />
      )}

      {/* Rich-text toolbar "insert image": the picked URL is posted back to the bridge, which inserts the
          <img> at the caret it saved before this modal opened (the region's rich-edit then persists it). */}
      {mediaInsert && (
        <FilePicker
          projectId={project.id}
          accept={ACCEPT.image}
          title="Insert image"
          onPick={(url) => {
            iframeRef.current?.contentWindow?.postMessage(
              { source: 'sitewright-editor', type: 'insert-media', url: safeUrl(url, '') },
              '*',
            );
            setMediaInsert(false);
          }}
          onClose={() => setMediaInsert(false)}
        />
      )}

      {/* {{sw-control}} as="image"/"file" → pick an asset for the control's target (e.g. the OG image,
          or a downloadable file); the picker is filtered to images or uploaded files accordingly. */}
      {controlPick !== null && (
        <FilePicker
          projectId={project.id}
          accept={controlPick.as === 'file' ? ACCEPT.file : ACCEPT.image}
          title={controlPick.as === 'file' ? 'Choose file' : 'Choose image'}
          onPick={(url) => {
            applyControlEdit(controlPick.target, controlPick.as, url);
            setControlPick(null);
          }}
          onClose={() => setControlPick(null)}
        />
      )}

      {/* The Regions rail: a deterministic index of every editable region on the page (bridge manifest);
          click a row → the preview scrolls to + flashes it and opens its editor. Content mode only —
          there are no editable regions to index in source/code mode. */}
      {mode === 'content' && (
        <RegionsPanel
          regions={regions}
          projectId={project.id}
          onEdit={(rid) =>
            iframeRef.current?.contentWindow?.postMessage({ source: 'sitewright-editor', type: 'edit-region', rid }, '*')
          }
        />
      )}

      {/* Clicking a rendered dataset row opens its entry editor (stacked); saving refreshes the preview. */}
      {openEntry && (
        <EntryEditorLoader
          projectId={project.id}
          dataset={openEntry.dataset}
          id={openEntry.id}
          onSaved={() => {
            inlineKeyRef.current = null;
            setPreviewNonce((n) => n + 1);
            setOpenEntry(null);
          }}
          onClose={() => setOpenEntry(null)}
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
            applySettings(values);
            setSettingsOpen(false);
          }}
        />
      )}
      {/* Per-page custom data → {{ page.data.* }}, edited in the reused tree/JSON store editor. */}
      {pageDataOpen && (
        <WebsiteDataModal
          title="Page data"
          namespace="page.data"
          value={pageData}
          onSave={setPageData}
          onClose={() => setPageDataOpen(false)}
        />
      )}
      {historyOpen && (
        <RevisionHistoryModal
          projectId={project.id}
          kind="page"
          entityId={page.id}
          label={page.title}
          onClose={() => setHistoryOpen(false)}
          onRestored={() => void reload()}
        />
      )}
      {dialog}
    </Modal>
  );
}
