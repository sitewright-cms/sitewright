import { useCallback, useEffect, useRef, useState } from 'react';
import { useUnsavedWork } from '../lib/unsaved-work';
import { api, previewDocUrl, type Project } from '../api';
import { CodeEditor, type CodeEditorHandle } from '../lib/code-editor';
import { findEachBlock, findElementRange, narrowToText } from '../lib/source-locate';
import { DANGEROUS_KEYS, isTranslationKey, websiteDataPathOf } from '../lib/page-data';
import { classifyControlTarget, normalizeControlAs } from '@sitewright/blocks/control';
import { safeUrl } from '@sitewright/blocks/url';
import { useCiPalette } from '../lib/ci-palette';
import { EntryEditorLoader } from './datasets/EntryEditorLoader';
import { FormEditorModal } from './FormEditorModal';
import { HtmlSourceModal } from './editor/HtmlSourceModal';
import { FilePicker } from './files/FilePicker';
import { ImageDialog } from './files/ImageDialog';
import { ACCEPT } from './files/FileBrowser';
import { ImageMapStudio } from './library/imagemap/ImageMapStudio';
import { RegionsPanel, type RegionItem } from './code/RegionsPanel';
import type { Form } from '@sitewright/schema';
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
  /**
   * Switch this editor to a DIFFERENT chrome slot — from the header picker, or from clicking the
   * "Edit <slot>" affordance on another landmark in the preview.
   *
   * The owner performs the switch (it holds the slot's source), and it must REPLACE rather than stack:
   * two slot editors open at once would each be previewing the same skeleton against its own draft,
   * with only one of them able to be right. Absent → the editor is fixed to one slot and shows a plain
   * title instead of a picker.
   */
  onSwitchSlot?: (slot: ChromeSlotKey) => void;
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
export function SlotEditor({ project, slot, value, onSave, onSwitchSlot, locales = [], onClose }: SlotEditorProps) {
  // A slot renders on every locale, so an inline translation edit writes the DEFAULT locale's cell —
  // the one the authored fallback stands in for. Per-locale wording stays the Translations table's job.
  const locale = locales[0] ?? 'en';
  const [source, setSource] = useState(value);
  const [mode, setMode] = useState<'source' | 'content'>('source'); // slots are markup first
  const [device, setDevice] = useState<PreviewDeviceKey>('desktop');
  const [previewSrc, setPreviewSrc] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // Bumped when something OUTSIDE the slot source changes what it renders (a saved form
  // definition), so the preview re-POSTs instead of showing the stale embed.
  const [previewNonce, setPreviewNonce] = useState(0);
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
  // Guard LEAVING the page too, not just closing this surface — see lib/unsaved-work.
  useUnsavedWork(dirty, 'Chrome slot');

  /** Tell the freshly-loaded preview which slot it shows (which also scrolls it into view) and the mode. */
  const syncPreview = useCallback(() => {
    const win = iframeRef.current?.contentWindow;
    win?.postMessage({ source: 'sitewright-editor', type: 'setMode', mode: modeRef.current }, '*');
    win?.postMessage({ source: 'sitewright-editor', type: 'setSlotFocus', slot }, '*');
    // The on-page rich-text toolbar reads the project's brand colours + font slots from this. Without
    // it the toolbar in a slot offered the stock palette only, so a colour picked in the footer could
    // not be one of the site's own — the same toolbar, quietly less capable depending where you opened it.
    win?.postMessage(
      { source: 'sitewright-editor', type: 'ci-palette', colors: ciRef.current.colors, fonts: ciRef.current.fonts },
      '*',
    );
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
          // `#sw-y=` restores the scroll the bridge last reported (see the 'scroll' branch): this
          // preview re-POSTs on every keystroke, and a footer that jumps back to the top on each one
          // is unusable to edit.
          setPreviewSrc(
            token ? previewDocUrl(project.slug, token) + (scrollYRef.current ? `#sw-y=${scrollYRef.current}` : '') : '',
          );
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
  }, [project.id, project.slug, slot, source, previewNonce]);

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
  // A form embedded IN a slot (a footer newsletter sign-up, say) — its definition is a project
  // entity, not slot markup, so it opens the same modal the page editor and Forms tab use.
  const [formEdit, setFormEdit] = useState<Form | null>(null);
  // The dataset row clicked in the preview (data-sw-entry), or null. A slot has no page.data, so its
  // REPEATED content — nav-adjacent lists, client logos, "why us" slides, capability bars — can only
  // come from a dataset; opening that row's editor from the slot it renders in is therefore the main
  // way to edit a slot's content at all, not a side path.
  const [openEntry, setOpenEntry] = useState<{ dataset: string; id: string } | null>(null);
  // --- The rest of the preview bridge's vocabulary. A slot used to answer only 8 of the bridge's 19
  // outbound messages, so a directive could render its affordance, highlight on hover, swallow the
  // click — and do nothing, with no error anywhere. The gate for "does this belong here?" is NOT the
  // message, it is the STORE behind it: a slot has no page.data, so only `website.data.<path>` keys
  // (and the shared translation catalog) can persist. Every branch below re-checks that.
  /** `website.data` path of an image/background region clicked in the preview → the file picker. */
  const [pickerKey, setPickerKey] = useState<string | null>(null);
  /** `{{sw-control}}` as="image"/"file" → the picker; the pick writes the control's website.data target. */
  const [controlPick, setControlPick] = useState<{ target: string; as: 'image' | 'file' } | null>(null);
  /** The rich-text toolbar's "insert image" → dialog; the pick is posted BACK to the bridge. */
  const [mediaInsert, setMediaInsert] = useState(false);
  /** Double-clicked a rich-content image → the pre-filled image-settings dialog. */
  const [mediaEdit, setMediaEdit] = useState<{ url: string; alt: string; width: string; height: string } | null>(null);
  /** A stored image map clicked in the slot → the Studio (a project entity, so it is slot-editable). */
  const [openImageMap, setOpenImageMap] = useState<string | null>(null);
  /** The bridge's editable-region manifest → the Regions rail (the reliable way to reach hidden/repeated content). */
  const [regions, setRegions] = useState<RegionItem[]>([]);
  /** The `data-sw-html` region open in the source modal (toolbar `</>`): its website.data key + seed HTML. */
  const [htmlSource, setHtmlSource] = useState<{ key: string; html: string } | null>(null);
  /** Preview scroll position, echoed back on the next re-render so typing doesn't jump the slot to the top. */
  const scrollYRef = useRef(0);
  // The project's CI palette for the on-page rich-text toolbar (brand colours + font slots). Context,
  // not a fetch — App provides it, and the slot editor renders inside that subtree.
  const ci = useCiPalette();
  const ciRef = useRef(ci);
  ciRef.current = ci;
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

  /**
   * Queue one `website.data.<path>` write on the shared debounced flush. Keyed by PATH (not by the
   * raw `website.data.…` directive key), so the same leaf written from two different affordances — an
   * inline edit and the link popover, say — coalesces to ONE pending cell instead of racing itself.
   * Every caller has already resolved + validated the path via `websiteDataPathOf`.
   */
  const queueWebsiteData = useCallback(
    (path: string, value: string) => {
      pendingWdRef.current.set(path, { key: path, value });
      if (wdTimerRef.current) clearTimeout(wdTimerRef.current);
      wdTimerRef.current = setTimeout(() => void flushWebsiteData(), 600);
    },
    [flushWebsiteData],
  );

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
        text?: string; textHit?: string; ds?: string; key?: string; value?: string; html?: string; slot?: string;
        dataset?: string; y?: number; target?: string; as?: string; hrefKey?: string; href?: string;
        textKey?: string; url?: string; alt?: string; width?: string; height?: string; items?: RegionItem[];
      } | null;
      if (!d || d.source !== 'sitewright-preview') return;
      if (d.type === 'ready') {
        // A fresh doc: drop the stale region manifest (the new one re-posts on entering content mode)
        // and re-apply mode + slot focus + the CI palette the on-page rich toolbar reads.
        setRegions([]);
        syncPreview();
      } else if (d.type === 'scroll' && typeof d.y === 'number') {
        // The slot preview re-POSTs on every keystroke; without remembering the offset each re-render
        // slammed the iframe back to the top, which for a FOOTER means it leaves the screen entirely.
        scrollYRef.current = d.y;
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
        queueWebsiteData(websiteDataPathOf(d.key) as string, (d.type === 'edit' ? d.value : d.html) as string);
      } else if (d.type === 'edit-slot' && typeof d.slot === 'string') {
        // The preview offers "Edit <slot>" on every landmark that is NOT the one being edited. Clicking
        // it switches THIS editor rather than opening a second one — see onSwitchSlot.
        if (CHROME_SLOTS.some((c) => c.key === d.slot)) switchSlotRef.current(d.slot as ChromeSlotKey);
      } else if (
        d.type === 'open-entry' &&
        typeof d.dataset === 'string' &&
        d.dataset !== '' &&
        typeof d.id === 'string' &&
        d.id !== '' &&
        !DANGEROUS_KEYS.has(d.dataset) &&
        !DANGEROUS_KEYS.has(d.id)
      ) {
        // Clicked a rendered dataset row in the slot preview → open that entry's editor, exactly as the
        // page editor does for a row in the page body. Without this branch the bridge's `open-entry`
        // arrived here and fell through to nothing: the row highlighted on hover and swallowed the click,
        // so a dataset-driven footer looked like it simply could not be edited.
        setOpenEntry({ dataset: d.dataset, id: d.id });
      } else if (d.type === 'pick-image' && typeof d.key === 'string' && websiteDataPathOf(d.key) !== null) {
        // Clicked an editable image/background → the file picker. The bridge only wires a slot's
        // data-sw-src/bg when its key is a `website.data.…` one, so by the time this arrives the key
        // HAS a store; re-checked here anyway because the message crosses a postMessage boundary.
        // Until now this went nowhere, which is why a logo in the header could not be replaced at all.
        setPickerKey(websiteDataPathOf(d.key) as string);
      } else if (
        d.type === 'link-edit' &&
        typeof d.hrefKey === 'string' &&
        websiteDataPathOf(d.hrefKey) !== null &&
        typeof d.href === 'string'
      ) {
        // The link popover (URL + optional text) → the site-wide store. Scheme-sanitized here as well
        // as at render, so what is STORED is already canonical-clean.
        queueWebsiteData(websiteDataPathOf(d.hrefKey) as string, safeUrl(d.href, ''));
        if (typeof d.textKey === 'string' && websiteDataPathOf(d.textKey) !== null && typeof d.text === 'string') {
          queueWebsiteData(websiteDataPathOf(d.textKey) as string, d.text);
        }
      } else if (d.type === 'edit-html-source' && typeof d.key === 'string' && websiteDataPathOf(d.key) !== null) {
        // The rich-text toolbar's `</>` → the HTML source editor for that region. Seeded with the stored
        // override when there is one, else the live authored default the bridge sent as innerHTML.
        const path = websiteDataPathOf(d.key) as string;
        const stored = pendingWdRef.current.get(path)?.value;
        setHtmlSource({ key: path, html: typeof stored === 'string' ? stored : typeof d.html === 'string' ? d.html : '' });
      } else if (d.type === 'control-edit' && typeof d.target === 'string' && typeof d.value === 'string') {
        // {{sw-control}} set a value. A slot can only persist a `website.data` target — a `page.*` field
        // or a bare page.data key belongs to whatever page happens to render this chrome, so writing it
        // from here would silently attribute a site-wide edit to one page. Those are ignored, not guessed.
        const t = classifyControlTarget(d.target);
        if (t?.kind === 'website') {
          const as = normalizeControlAs(d.as);
          queueWebsiteData(t.key, as === 'image' || as === 'file' || as === 'url' ? safeUrl(d.value, '') : d.value);
        }
      } else if (d.type === 'control-pick-image' && typeof d.target === 'string') {
        const t = classifyControlTarget(d.target);
        if (t?.kind === 'website') setControlPick({ target: t.key, as: d.as === 'file' ? 'file' : 'image' });
      } else if (d.type === 'pick-media') {
        // Rich toolbar "insert image" — a free insertion, no key: the pick is posted BACK to the bridge,
        // which inserts the <img> at the caret it saved, and the resulting rich-edit persists it.
        setMediaInsert(true);
      } else if (d.type === 'edit-media' && typeof d.url === 'string') {
        setMediaEdit({
          url: d.url,
          alt: typeof d.alt === 'string' ? d.alt : '',
          width: typeof d.width === 'string' ? d.width : '',
          height: typeof d.height === 'string' ? d.height : '',
        });
      } else if (d.type === 'open-imagemap' && typeof d.id === 'string' && d.id !== '' && !DANGEROUS_KEYS.has(d.id)) {
        // An image map is a PROJECT entity (like a form), not page content — so it is editable from the
        // slot that renders it, on the same footing as the form editor below.
        setOpenImageMap(d.id);
      } else if (d.type === 'regions' && Array.isArray(d.items)) {
        setRegions(
          d.items.filter((r) => r && Number.isInteger(r.rid) && typeof r.kind === 'string' && typeof r.label === 'string'),
        );
      } else if (d.type === 'link-click') {
        // DELIBERATELY IGNORED. On a page this switches the editor to the clicked page; a slot editor is
        // not looking at a page (its canvas is the empty one) and has nowhere to navigate to. The bridge
        // has already suppressed the navigation, which is the part that matters — the chrome's own links
        // must not drag the preview off to another document mid-edit.
      } else if (d.type === 'open-form' && typeof d.id === 'string' && d.id !== '') {
        void api
          .listForms(project.id)
          .then(({ items }) => {
            const found = items.find((f) => f.id === d.id);
            if (found) setFormEdit(found);
            else setStoreError(`Form "${d.id}" no longer exists`);
          })
          .catch((err: unknown) => setStoreError(err instanceof Error ? err.message : 'failed to load form'));
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

  /**
   * Move this editor to another slot. Guarded on `dirty` because the switch REPLACES the draft — the
   * slot editor's Save owns the source, and nothing else would ever write it back.
   */
  const switchSlot = useCallback(
    (next: ChromeSlotKey) => {
      if (!onSwitchSlot || next === slot) return;
      if (dirty && !window.confirm(`Discard unsaved changes to ${slotLabel(slot)}?`)) return;
      onSwitchSlot(next);
    },
    [onSwitchSlot, slot, dirty],
  );
  const switchSlotRef = useRef(switchSlot);
  switchSlotRef.current = switchSlot;

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

  // The title IS the slot picker: the five slots are one subject seen five ways, and the editor is
  // identical for each, so getting from one to another should not mean closing this and going back to
  // Settings. Falls back to a plain title when the owner cannot switch (no onSwitchSlot).
  const slotPicker = onSwitchSlot ? (
    <label className="flex min-w-0 items-center gap-1.5">
      <span className="sr-only">Chrome slot</span>
      <select
        value={slot}
        onChange={(e) => switchSlot(e.target.value as ChromeSlotKey)}
        className="max-w-[16rem] cursor-pointer truncate rounded-lg border border-transparent bg-transparent py-0.5 pl-1.5 pr-6 text-sm font-bold text-slate-800 outline-none transition hover:border-slate-300 hover:bg-white/70 dark:text-slate-100 dark:hover:border-white/15 dark:hover:bg-white/10"
      >
        {CHROME_SLOTS.map((c) => (
          <option key={c.key} value={c.key}>
            {c.label}
          </option>
        ))}
      </select>
    </label>
  ) : undefined;

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
      titleControl={slotPicker}
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
              : `border border-white/50 dark:border-white/10 ${stripExpanded ? 'h-[45dvh]' : 'h-36'}`
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
            {formEdit && (
              <FormEditorModal
                project={project}
                form={formEdit}
                onSaved={() => setPreviewNonce((n) => n + 1)}
                onClose={() => setFormEdit(null)}
              />
            )}
            {/* Same footing as the form editor above: a dataset row is a SHARED store, saved on its own
                and independent of the slot's Save, so the preview must re-POST to show the new values. */}
            {openEntry && (
              <EntryEditorLoader
                projectId={project.id}
                dataset={openEntry.dataset}
                id={openEntry.id}
                onSaved={() => {
                  setPreviewNonce((n) => n + 1);
                  setOpenEntry(null);
                }}
                onClose={() => setOpenEntry(null)}
              />
            )}
            {/* Replace an image/background in the chrome. Writes the site-wide store, so the preview
                must re-POST to show it (there is no page draft here to carry the new value). */}
            {pickerKey && (
              <FilePicker
                projectId={project.id}
                accept={ACCEPT.image}
                title="Replace image"
                onPick={(url) => {
                  queueWebsiteData(pickerKey, safeUrl(url, ''));
                  setPickerKey(null);
                  setPreviewNonce((n) => n + 1);
                }}
                onClose={() => setPickerKey(null)}
              />
            )}
            {/* {{sw-control}} as="image"/"file" → pick an asset for the control's website.data target. */}
            {controlPick !== null && (
              <FilePicker
                projectId={project.id}
                accept={controlPick.as === 'file' ? ACCEPT.file : ACCEPT.image}
                title={controlPick.as === 'file' ? 'Choose file' : 'Choose image'}
                onPick={(url) => {
                  queueWebsiteData(controlPick.target, safeUrl(url, ''));
                  setControlPick(null);
                  setPreviewNonce((n) => n + 1);
                }}
                onClose={() => setControlPick(null)}
              />
            )}
            {/* Rich-toolbar image insert / double-click image settings. Neither writes a store: the
                chosen attrs go BACK to the bridge, which edits the live DOM at its saved caret — the
                resulting rich-edit is what persists, through the same queue as any other rich edit. */}
            {mediaInsert && (
              <ImageDialog
                projectId={project.id}
                onInsert={(img) => {
                  iframeRef.current?.contentWindow?.postMessage(
                    { source: 'sitewright-editor', type: 'insert-media', url: safeUrl(img.url, ''), alt: img.alt, width: img.width, height: img.height },
                    '*',
                  );
                  setMediaInsert(false);
                }}
                onClose={() => setMediaInsert(false)}
              />
            )}
            {mediaEdit && (
              <ImageDialog
                projectId={project.id}
                initial={mediaEdit}
                onInsert={(img) => {
                  iframeRef.current?.contentWindow?.postMessage(
                    { source: 'sitewright-editor', type: 'update-media', url: safeUrl(img.url, ''), alt: img.alt, width: img.width, height: img.height },
                    '*',
                  );
                  setMediaEdit(null);
                }}
                onClose={() => setMediaEdit(null)}
              />
            )}
            {/* The `</>` HTML source view for a rich region — saved to the site-wide store, then re-rendered. */}
            {htmlSource && (
              <HtmlSourceModal
                swKey={htmlSource.key}
                value={htmlSource.html}
                onSave={(html) => {
                  queueWebsiteData(htmlSource.key, html);
                  setHtmlSource(null);
                  setPreviewNonce((n) => n + 1);
                }}
                onClose={() => setHtmlSource(null)}
              />
            )}
            {/* An image map is a project entity, so it opens in the Studio from the slot that renders it. */}
            {openImageMap && (
              <ImageMapStudio
                projectId={project.id}
                initialMapId={openImageMap}
                onSaved={() => setPreviewNonce((n) => n + 1)}
                onClose={() => setOpenImageMap(null)}
              />
            )}
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

      {/* The Regions rail — the reliable way to reach a region the chrome hides, occludes or repeats
          (a closed drawer, a carousel slide) — which is most of what chrome IS. Content mode only:
          there are no editable regions to index while the slot is being edited as code.

          ★ RENDERED OUTSIDE <DevicePreview>, unlike the modals above. Those go through <Modal>, which
          portals to <body>; the rail is a SidePanel and does NOT portal. DevicePreview always carries a
          `transform` (that is how it simulates a device width), and a transformed ancestor becomes the
          containing block for `position: fixed` — so inside it the rail would be positioned against the
          scaled preview box rather than the viewport, and would shrink with it on a mobile preview. */}
      {mode === 'content' && (
        <RegionsPanel
          regions={regions}
          projectId={project.id}
          onEdit={(rid) =>
            iframeRef.current?.contentWindow?.postMessage({ source: 'sitewright-editor', type: 'edit-region', rid }, '*')
          }
        />
      )}
    </Modal>
  );
}
