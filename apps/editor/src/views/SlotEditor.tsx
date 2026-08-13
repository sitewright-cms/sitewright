import { useCallback, useEffect, useRef, useState } from 'react';
import { api, previewDocUrl, type Project } from '../api';
import { CodeEditor, type CodeEditorHandle } from '../lib/code-editor';
import { findEachBlock, findElementRange, narrowToText } from '../lib/source-locate';
import { isTranslationKey, websiteDataPathOf } from '../lib/page-data';
import { PreviewPane } from './editor/PreviewPane';
import { DEVICE_ICONS, DevicePreview, PREVIEW_DEVICES, type PreviewDeviceKey } from './editor/DevicePreview';
import { Modal } from './ui/Modal';
import { Tooltip } from './ui/Tooltip';
import { gradientSurface } from '../theme';

/**
 * The five chrome slots, in skeleton order. `key` is the settings field; `label` is what the user is
 * told they are editing (and what the preview's hover affordance says).
 */
export const CHROME_SLOTS = [
  { key: 'mainNav', label: 'Main Navigation' },
  { key: 'sidebarLeft', label: 'Left Sidebar' },
  { key: 'sidebarRight', label: 'Right Sidebar' },
  { key: 'footer', label: 'Footer' },
  { key: 'bottom', label: 'Bottom' },
] as const;

export type ChromeSlotKey = (typeof CHROME_SLOTS)[number]['key'];

export function slotLabel(key: string): string {
  return CHROME_SLOTS.find((s) => s.key === key)?.label ?? key;
}

/**
 * The page the slot is previewed AGAINST: deliberately EMPTY, one viewport tall.
 *
 * A slot only means anything as chrome around a page, so it is rendered in a real page context —
 * that is what makes `{{#each nav.header}}`, `{{#if (sw-active path)}}`, the sticky-header state and
 * the container alignment resolve at all. But real page content would only be noise here, so the body
 * is an empty full-height block: the chrome still has a document to sit around, scroll over and align
 * to, with nothing competing for attention.
 */
const EMPTY_CANVAS_SOURCE = '<div class="min-h-screen"></div>';

interface SlotEditorProps {
  project: Project;
  /** Which chrome slot is being edited. */
  slot: ChromeSlotKey;
  /** Its current saved source. */
  value: string;
  /** Persist the slot (the caller owns the settings write). */
  onSave: (slot: ChromeSlotKey, source: string) => Promise<void> | void;
  /** Project locales, default-first — the locale an inline translation edit writes. */
  locales?: readonly string[];
  onClose: () => void;
}

/**
 * The chrome-slot editor: the page editor's experience with a SLOT as its subject — same shell, same
 * stacked layout (a source strip that peeks and expands on hover over a live preview), same in-preview
 * device rail. No audit tab (that scores a page, and a slot is not one), and it opens in CODE mode
 * because a slot is markup first. Stacks OVER the page editor when reached from there.
 */
export function SlotEditor({ project, slot, value, onSave, locales = [], onClose }: SlotEditorProps) {
  // A slot renders on every locale, so an inline translation edit writes the DEFAULT locale's cell —
  // the one the authored fallback stands in for. Per-locale wording stays the Translations table's job.
  const locale = locales[0] ?? 'en';
  const [source, setSource] = useState(value);
  const [mode, setMode] = useState<'source' | 'content'>('source'); // slots are markup first
  const [device, setDevice] = useState<PreviewDeviceKey>('desktop');
  const [previewSrc, setPreviewSrc] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // The source strip peeks on open and expands while hovered or focused — the page editor's gesture,
  // so the preview keeps the room until you actually reach for the code.
  const [stripHover, setStripHover] = useState(false);
  const [stripFocus, setStripFocus] = useState(false);
  const stripExpanded = stripHover || stripFocus;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const codeRef = useRef<CodeEditorHandle>(null);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const dirty = source !== value;

  /** Tell the freshly-loaded preview which slot it shows (which also scrolls it into view) and the mode. */
  const syncPreview = useCallback(() => {
    const win = iframeRef.current?.contentWindow;
    win?.postMessage({ source: 'sitewright-editor', type: 'setMode', mode: modeRef.current }, '*');
    win?.postMessage({ source: 'sitewright-editor', type: 'setSlotFocus', slot }, '*');
  }, [slot]);

  // Re-render the preview as the slot is typed (debounced). The page is the empty canvas; the slot
  // rides as an OVERRIDE so what renders is the draft, not what was last saved.
  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      setPreviewLoading(true);
      void api
        .preview(project.id, { id: 'slot-canvas', path: '', title: slotLabel(slot), source: EMPTY_CANVAS_SOURCE }, { [slot]: source })
        .then(({ token }) => {
          if (cancelled) return;
          setPreviewSrc(token ? previewDocUrl(project.slug, token) : '');
          setPreviewError(null);
          setPreviewLoading(false);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          // A slot that fails the save-time gate reports here rather than rendering something the
          // save would refuse — the same message the settings write would give.
          setPreviewError(err instanceof Error ? err.message : 'preview failed');
          setPreviewLoading(false);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(handle);
      setPreviewLoading(false);
    };
  }, [project.id, project.slug, slot, source]);

  // Push mode changes to a preview that is already loaded.
  useEffect(() => {
    syncPreview();
  }, [mode, syncPreview]);

  // --- The two stores a SLOT can actually write to ------------------------------------------------
  // A slot is not a page, so it has no page.data: its editable leaves are the SHARED project
  // translation catalog (data-sw-translate) and the site-wide website.data store (an explicit
  // `website.data.<path>` key). Both auto-save on their own endpoints, debounced, exactly as the page
  // editor does — the slot's own Save button owns the SOURCE, never these values.
  //
  // These edits are only reachable HERE: the preview bridge wires a chrome-slot leaf only while that
  // slot is focused, so the same shared string can't also be edited from a page, where it would read
  // as a page-local change while quietly rewriting every page.
  const pendingTrRef = useRef(new Map<string, { key: string; value: string }>());
  const trTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingWdRef = useRef(new Map<string, { key: string; value: string }>());
  const wdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [storeError, setStoreError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const flushTranslations = useCallback(async () => {
    trTimerRef.current = null;
    const cells = [...pendingTrRef.current.values()];
    pendingTrRef.current.clear();
    for (const c of cells) {
      try {
        await api.setTranslation(project.id, c.key, locale, c.value);
      } catch (err) {
        if (mounted.current) setStoreError(err instanceof Error ? `Translation not saved: ${err.message}` : 'Translation not saved');
      }
    }
  }, [project.id, locale]);

  const flushWebsiteData = useCallback(async () => {
    wdTimerRef.current = null;
    const cells = [...pendingWdRef.current.values()];
    pendingWdRef.current.clear();
    for (const c of cells) {
      try {
        await api.setWebsiteData(project.id, c.key, c.value);
      } catch (err) {
        if (mounted.current) setStoreError(err instanceof Error ? `Website data not saved: ${err.message}` : 'Website data not saved');
      }
    }
  }, [project.id]);

  // Flush anything still inside the debounce window if the editor closes — otherwise the last
  // keystrokes of an edit are lost precisely when the user thinks they are done.
  useEffect(
    () => () => {
      if (trTimerRef.current) {
        clearTimeout(trTimerRef.current);
        for (const c of pendingTrRef.current.values()) void api.setTranslation(project.id, c.key, locale, c.value).catch(() => {});
      }
      if (wdTimerRef.current) {
        clearTimeout(wdTimerRef.current);
        for (const c of pendingWdRef.current.values()) void api.setWebsiteData(project.id, c.key, c.value).catch(() => {});
      }
    },
    [project.id, locale],
  );

  // The preview → editor bridge: click-to-code, scoped by the preview to this slot's landmark.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const d = e.data as {
        source?: string; type?: string; tag?: string; id?: string; cls?: unknown; nth?: number;
        text?: string; textHit?: string; ds?: string; key?: string; value?: string; html?: string;
      } | null;
      if (!d || d.source !== 'sitewright-preview') return;
      if (d.type === 'ready') {
        syncPreview();
      } else if (d.type === 'translate-edit' && typeof d.key === 'string' && typeof d.value === 'string' && isTranslationKey(d.key)) {
        // data-sw-translate in this slot → the SHARED catalog. The contenteditable already shows the
        // new text, so nothing re-renders; only the write is queued.
        pendingTrRef.current.set(d.key, { key: d.key, value: d.value });
        if (trTimerRef.current) clearTimeout(trTimerRef.current);
        trTimerRef.current = setTimeout(() => void flushTranslations(), 600);
      } else if (
        (d.type === 'edit' || d.type === 'rich-edit') &&
        typeof d.key === 'string' &&
        websiteDataPathOf(d.key) !== null &&
        typeof (d.type === 'edit' ? d.value : d.html) === 'string'
      ) {
        // data-sw-text / data-sw-html with a `website.data.<path>` key → the site-wide store. A BARE
        // key never reaches here: the bridge does not wire one inside a slot, because a slot has no
        // page.data for it to land in and the edit would silently evaporate.
        pendingWdRef.current.set(d.key, {
          key: websiteDataPathOf(d.key) as string,
          value: (d.type === 'edit' ? d.value : d.html) as string,
        });
        if (wdTimerRef.current) clearTimeout(wdTimerRef.current);
        wdTimerRef.current = setTimeout(() => void flushWebsiteData(), 600);
      } else if (d.type === 'locate-source' && typeof d.tag === 'string' && modeRef.current === 'source') {
        const range =
          findElementRange(sourceRef.current, {
            tag: d.tag,
            id: d.id || undefined,
            classes: Array.isArray(d.cls) ? d.cls.filter((c): c is string => typeof c === 'string') : undefined,
            text: typeof d.text === 'string' ? d.text : undefined,
            nth: typeof d.nth === 'number' ? d.nth : 0,
          }) ?? (typeof d.ds === 'string' && d.ds ? findEachBlock(sourceRef.current, d.ds) : null);
        if (range) {
          // Clicking WORDS selects just those words; clicking the element's box selects the whole tag.
          const picked =
            typeof d.textHit === 'string' && d.textHit ? narrowToText(sourceRef.current, range, d.textHit) : range;
          codeRef.current?.selectRange(picked.from, picked.to);
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [syncPreview, flushTranslations, flushWebsiteData]);

  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(slot, sourceRef.current);
    } finally {
      setSaving(false);
    }
  }, [onSave, saving, slot]);

  const editModeSwitch = (
    <div
      role="group"
      aria-label="Edit mode"
      className="flex items-center rounded-xl border border-white/60 dark:border-white/10 bg-white/50 dark:bg-white/5 p-0.5 text-xs font-medium shadow-sm backdrop-blur-xl"
    >
      {(['source', 'content'] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => setMode(m)}
          className={`waves-effect rounded-lg px-2.5 py-1 transition ${
            mode === m ? `${gradientSurface} font-bold` : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100'
          }`}
        >
          {m === 'source' ? 'Code Editor' : 'Content Editor'}
        </button>
      ))}
    </div>
  );

  return (
    <Modal
      title={slotLabel(slot)}
      size="screen"
      onClose={onClose}
      onBeforeClose={() => !dirty || window.confirm('Discard unsaved changes to this slot?')}
      onSave={() => void save()}
      saving={saving}
      saveDisabled={!dirty}
      headerLeft={editModeSwitch}
      centerTitle
      titleExtra={<span className="hidden text-xs text-slate-500 dark:text-slate-400 sm:inline">skeleton slot · every page</span>}
    >
      <div className="flex h-full flex-col gap-2 bg-slate-100/50 dark:bg-white/5 p-2">
        {/* Row 1 — the source strip, SOURCE MODE: peeking on open, expanding while hovered or focused.
            CONTENT mode gives it away to the preview, exactly as the page editor does — there, every
            editable element is marked in the preview itself. As in the page editor it COLLAPSES rather
            than unmounting, so the mode switch glides and `visibility` (discrete, so it steps at the
            end of the collapse) takes the hidden editor out of the tab order. */}
        <section
          aria-label="Slot source editor"
          data-expanded={stripExpanded}
          data-collapsed={mode !== 'source'}
          className={`shrink-0 overflow-hidden rounded-2xl bg-[#0a0a0f] shadow-xl shadow-slate-900/10 transition-all duration-300 ease-out ${
            mode !== 'source'
              ? 'invisible h-0 opacity-0'
              : `border border-white/50 dark:border-white/10 ${stripExpanded ? 'h-[45vh]' : 'h-36'}`
          }`}
          onMouseEnter={() => setStripHover(true)}
          onMouseLeave={() => setStripHover(false)}
          // Pinned open by REACHING FOR THE CODE — a click or a keystroke inside the strip — not by
          // focus. Click-to-code focuses the editor programmatically to place the selection, and
          // keying that to the expansion meant every click in the preview threw the strip open over
          // the very preview being clicked. Pointer and keyboard entry still pin it, so the strip does
          // not collapse out from under someone editing who moves the mouse away.
          onMouseDownCapture={() => setStripFocus(true)}
          onKeyDownCapture={() => setStripFocus(true)}
          onBlurCapture={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setStripFocus(false);
          }}
        >
          <CodeEditor ref={codeRef} value={source} onChange={setSource} ariaLabel={`${slotLabel(slot)} source`} />
        </section>

        {/* Row 2 — the preview, with the device rail pinned inside it (vertical, like the page editor). */}
        <div className="relative min-h-0 flex-1">
          <DevicePreview width={PREVIEW_DEVICES.find((d) => d.key === device)!.width}>
            <PreviewPane src={previewSrc} loading={previewLoading} error={previewError} title="Slot preview" iframeRef={iframeRef} />
            {/* A shared-store write is auto-saved and separate from the slot's own Save, so a failure
                has no other way to surface — without this it would look like the edit stuck. */}
            {storeError && (
              <div
                role="alert"
                className="absolute inset-x-3 bottom-3 z-10 flex items-center justify-between gap-3 rounded-xl border border-rose-300 dark:border-rose-500/40 bg-rose-50 dark:bg-rose-950/70 px-3 py-2 text-sm text-rose-800 dark:text-rose-200 shadow-lg backdrop-blur"
              >
                <span>{storeError}</span>
                <button type="button" className="shrink-0 rounded-lg px-2 py-0.5 font-semibold hover:bg-rose-100 dark:hover:bg-rose-900" onClick={() => setStoreError(null)}>
                  Dismiss
                </button>
              </div>
            )}
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
                    device === d.key
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-500 dark:text-slate-400 hover:bg-white dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {DEVICE_ICONS[d.key]}
                </button>
              </Tooltip>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
