import { useCallback, useEffect, useRef, useState } from 'react';
import { Code, Eye, Save, X } from 'lucide-react';
import { api, previewDocUrl, type Project } from '../api';
import { CodeEditor, type CodeEditorHandle } from '../lib/code-editor';
import { findEachBlock, findElementRange } from '../lib/source-locate';
import { PreviewPane } from './editor/PreviewPane';
import { DevicePreview, PREVIEW_DEVICES, type PreviewDeviceKey } from './editor/DevicePreview';
import { Tooltip } from './ui/Tooltip';
import { ghostButton, primaryButton } from '../theme';

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
  onClose: () => void;
}

/**
 * The chrome-slot editor: the page editor's experience with a SLOT as its subject — code + live
 * preview, the responsive device toolbar, click-to-code selection, and a content mode. No audit tab
 * (that scores a page, and a slot is not one), and it opens in CODE mode because a slot is markup
 * first. It stacks OVER the page editor when reached from there, so closing returns you where you were.
 */
export function SlotEditor({ project, slot, value, onSave, onClose }: SlotEditorProps) {
  const [source, setSource] = useState(value);
  const [mode, setMode] = useState<'source' | 'content'>('source'); // slots are markup first
  const [device, setDevice] = useState<PreviewDeviceKey>('desktop');
  const [previewSrc, setPreviewSrc] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const codeRef = useRef<CodeEditorHandle>(null);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const dirty = source !== value;

  const width = PREVIEW_DEVICES.find((d) => d.key === device)?.width ?? null;

  /** Tell the freshly-loaded preview which slot it is showing, and in which edit mode. */
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

  // The preview → editor bridge: click-to-code, and the content-mode edits a slot can make.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const d = e.data as { source?: string; type?: string; tag?: string; id?: string; cls?: unknown; nth?: number; text?: string; ds?: string } | null;
      if (!d || d.source !== 'sitewright-preview') return;
      if (d.type === 'ready') {
        syncPreview();
      } else if (d.type === 'locate-source' && typeof d.tag === 'string' && modeRef.current === 'source') {
        const range =
          findElementRange(sourceRef.current, {
            tag: d.tag,
            id: d.id || undefined,
            classes: Array.isArray(d.cls) ? d.cls.filter((c): c is string => typeof c === 'string') : undefined,
            text: typeof d.text === 'string' ? d.text : undefined,
            nth: typeof d.nth === 'number' ? d.nth : 0,
          }) ?? (typeof d.ds === 'string' && d.ds ? findEachBlock(sourceRef.current, d.ds) : null);
        if (range) codeRef.current?.selectRange(range.from, range.to);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [syncPreview]);

  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(slot, sourceRef.current);
    } finally {
      setSaving(false);
    }
  }, [onSave, saving, slot]);

  // Ctrl/Cmd+S saves; Esc closes (guarding unsaved work) — the page editor's shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (!dirty || window.confirm('Discard unsaved changes to this slot?')) onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, onClose, save]);

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-slate-100/95 dark:bg-slate-950/95 p-3 backdrop-blur-xl" role="dialog" aria-label={`Edit the ${slotLabel(slot)} slot`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{slotLabel(slot)}</span>
        <span className="rounded-md bg-slate-200/70 dark:bg-white/10 px-1.5 py-0.5 text-[11px] text-slate-600 dark:text-slate-300">
          skeleton slot · every page
        </span>
        {dirty && <span className="text-[11px] text-amber-600 dark:text-amber-400">unsaved</span>}

        <div className="ml-2 flex items-center rounded-xl border border-white/60 dark:border-white/10 bg-white/50 dark:bg-white/5 p-0.5 text-xs font-medium shadow-sm backdrop-blur-xl">
          {([
            ['source', 'Code', <Code key="c" className="h-3.5 w-3.5" />],
            ['content', 'Content', <Eye key="e" className="h-3.5 w-3.5" />],
          ] as const).map(([key, label, icon]) => (
            <button
              key={key}
              type="button"
              aria-pressed={mode === key}
              onClick={() => setMode(key)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 transition ${
                mode === key ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center rounded-xl border border-white/60 dark:border-white/10 bg-white/50 dark:bg-white/5 p-0.5 text-xs shadow-sm backdrop-blur-xl">
          {PREVIEW_DEVICES.map((d) => (
            <Tooltip key={d.key} tip={d.label} side="bottom">
              <button
                type="button"
                aria-label={d.label}
                aria-pressed={device === d.key}
                onClick={() => setDevice(d.key)}
                className={`rounded-lg px-2 py-1 transition ${
                  device === d.key ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {d.label.split(' ')[0]}
              </button>
            </Tooltip>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button type="button" className={`${primaryButton} px-3 py-1.5 text-xs`} onClick={() => void save()} disabled={!dirty || saving}>
            <Save className="mr-1 inline h-3.5 w-3.5" />
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            aria-label="Close the slot editor"
            className={`${ghostButton} px-2 py-1.5`}
            onClick={() => {
              if (!dirty || window.confirm('Discard unsaved changes to this slot?')) onClose();
            }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-2">
        <div className={`min-h-0 overflow-hidden rounded-2xl ${mode === 'source' ? '' : 'hidden lg:block'}`}>
          <CodeEditor
            ref={codeRef}
            value={source}
            onChange={setSource}
            language="html"
            ariaLabel={`${slotLabel(slot)} source`}
          />
        </div>
        <div className="min-h-0">
          <DevicePreview width={width}>
            <PreviewPane src={previewSrc} loading={previewLoading} error={previewError} title="Slot preview" iframeRef={iframeRef} />
          </DevicePreview>
        </div>
      </div>
    </div>
  );
}
