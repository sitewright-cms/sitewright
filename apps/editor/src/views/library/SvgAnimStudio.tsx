import { useEffect, useMemo, useRef, useState } from 'react';
import { SVG_ANIM_EFFECTS, SVG_ANIM_LIMITS } from '@sitewright/blocks';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';
import { useCopy } from '../ui/useCopy';
import { api } from '../../api';
import { glassInput, ghostButton, primaryButton, toggleInput } from '../../theme';
import { FilePicker } from '../files/FilePicker';
import { parseSvg, stampIds, buildTree, assetFromUrl, cssEsc, type TreeNode, type SourceAsset } from './svg-studio-helpers';

interface SvgAnimStudioProps {
  onClose: () => void;
  /** When present, enables "pick from media" (SVG files) + "save to media" (overwrite / new). */
  projectId?: string;
}

const EFFECT_LABELS: Record<string, string> = {
  draw: 'Draw on', fade: 'Fade', 'fade-up': 'Fade up', 'fade-down': 'Fade down', 'fade-left': 'Fade left', 'fade-right': 'Fade right',
  'zoom-in': 'Zoom in', 'zoom-out': 'Zoom out', 'flip-x': 'Flip X', 'flip-y': 'Flip Y', blur: 'Blur',
  'scale-c': 'Scale (center)', 'scale-t': 'Scale (top)', 'scale-b': 'Scale (bottom)', 'scale-l': 'Scale (left)', 'scale-r': 'Scale (right)',
  'scale-tl': 'Scale (top-left)', 'scale-tr': 'Scale (top-right)', 'scale-bl': 'Scale (bottom-left)', 'scale-br': 'Scale (bottom-right)',
  'expand-x': 'Expand X', 'expand-y': 'Expand Y', 'expand-t': 'Expand (top)', 'expand-b': 'Expand (bottom)', 'expand-l': 'Expand (left)', 'expand-r': 'Expand (right)',
  'along-path': 'Along path', 'reveal-right': 'Reveal →', 'reveal-left': 'Reveal ←', 'reveal-down': 'Reveal ↓', 'reveal-up': 'Reveal ↑', 'reveal-iris': 'Reveal iris', morph: 'Morph',
};
const EASINGS = ['ease-out', 'ease', 'ease-in', 'ease-in-out', 'linear', 'back', 'bounce', 'elastic'];

/**
 * The SVG Animation Studio — import an SVG, see every element in a tree, assign an animation (effect +
 * timing) to each, preview it live, and export the annotated inline SVG (or download the .svg). The engine
 * stores each animation AS data-sw-svg* attributes on the element, so the editor edits those directly and
 * export is just re-serialising the SVG. The live canvas is a sandboxed iframe running the real runtimes.
 */
export function SvgAnimStudio({ onClose, projectId }: SvgAnimStudioProps) {
  const [stage, setStage] = useState<'import' | 'edit'>('import');
  const [pasteText, setPasteText] = useState('');
  const [importError, setImportError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [source, setSource] = useState<SourceAsset | null>(null);
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState('animation');
  const [saveMsg, setSaveMsg] = useState('');
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [svgText, setSvgText] = useState('');
  const [, bump] = useState(0);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const readyRef = useRef(false);
  const toast = useToast();
  const [, copy] = useCopy(() => toast.show('Animated SVG copied — paste it into a code-first page, snippet or Html block'));

  const reserialize = () => {
    if (!svgRef.current) return;
    setSvgText(new XMLSerializer().serializeToString(svgRef.current));
  };

  const doImport = (text: string, src: SourceAsset | null = null) => {
    const svg = parseSvg(text);
    if (!svg) {
      setImportError('That doesn’t look like a valid SVG. Paste the full <svg>…</svg> markup.');
      return;
    }
    stampIds(svg);
    svgRef.current = svg;
    setTree(buildTree(svg, 0));
    setSelectedId('');
    setImportError('');
    setSource(src);
    setSaveMsg('');
    setSvgText(new XMLSerializer().serializeToString(svg));
    setStage('edit');
  };

  // Pick an existing SVG from the project's media library, fetch it, and import it (remembering the asset
  // so "Save" can overwrite it in place).
  const pickFromMedia = async (url: string) => {
    setPickerOpen(false);
    try {
      if (new URL(url, location.href).origin !== location.origin) {
        setImportError('Can only load SVGs hosted in this project.');
        return;
      }
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) {
        setImportError('Could not load that SVG from the library.');
        return;
      }
      doImport(await res.text(), assetFromUrl(url));
    } catch {
      setImportError('Could not load that SVG from the library.');
    }
  };
  const saveOverwrite = async () => {
    if (!projectId || !source) return;
    try {
      await api.overwriteSvgMedia(projectId, source.id, svgText);
      setSaveMsg(`Saved to ${source.filename}`);
      toast.show(`Saved to ${source.filename}`);
    } catch {
      setSaveMsg('Save failed');
    }
  };
  const saveNew = async () => {
    if (!projectId) return;
    const name = `${(newName.trim() || 'animation').replace(/\.svg$/i, '')}.svg`;
    try {
      const { item } = await api.uploadMedia(projectId, new File([svgText], name, { type: 'image/svg+xml' }));
      setSource({ id: item.id, filename: item.filename });
      setNaming(false);
      setSaveMsg(`Saved as ${item.filename}`);
      toast.show(`Saved ${item.filename} to the library`);
    } catch {
      setSaveMsg('Save failed');
    }
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => doImport(String(r.result || ''));
    r.readAsText(file);
  };

  // The selected element (live, from the parsed DOM) + a reader for its current attributes.
  const sel = selectedId && svgRef.current ? svgRef.current.querySelector(`[id="${cssEsc(selectedId)}"]`) : null;
  const attr = (n: string) => (sel ? sel.getAttribute(n) || '' : '');
  const effect = attr('data-sw-svg');

  const setAttr = (name: string, value: string | null) => {
    if (!sel) return;
    if (value === null || value === '') sel.removeAttribute(name);
    else sel.setAttribute(name, value);
    reserialize();
    bump((v) => v + 1);
  };
  const setEffect = (e: string) => {
    if (!sel) return;
    if (!e) {
      // remove animation entirely
      ['data-sw-svg', 'data-sw-duration', 'data-sw-delay', 'data-sw-easing', 'data-sw-once', 'data-sw-svg-dir', 'data-sw-svg-trigger', 'data-sw-svg-draw-dir', 'data-sw-svg-fill', 'data-sw-svg-draw-color', 'data-sw-svg-draw-width', 'data-sw-svg-origin', 'data-sw-svg-path', 'data-sw-svg-rotate', 'data-sw-svg-to'].forEach((a) => sel.removeAttribute(a));
    } else {
      sel.setAttribute('data-sw-svg', e);
      if (!sel.getAttribute('data-sw-duration')) sel.setAttribute('data-sw-duration', e === 'draw' ? '1200' : '600');
    }
    reserialize();
    bump((v) => v + 1);
  };

  // Push the current SVG to the sandboxed canvas whenever it changes; (re)send on ready.
  const previewSrc = useMemo(() => api.svgStudioPreviewUrl(), []);
  const svgRefText = useRef(svgText);
  svgRefText.current = svgText;
  const send = (m: unknown) => iframeRef.current?.contentWindow?.postMessage(m, '*');
  useEffect(() => {
    if (readyRef.current) send({ type: 'sw-studio-render', svg: svgText });
  }, [svgText]);
  useEffect(() => {
    if (readyRef.current) send({ type: 'sw-studio-highlight', id: selectedId });
  }, [selectedId]);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const d = e.data as { type?: string; id?: string } | null;
      if (d?.type === 'sw-studio-ready') {
        readyRef.current = true;
        send({ type: 'sw-studio-render', svg: svgRefText.current });
        if (selectedId) send({ type: 'sw-studio-highlight', id: selectedId });
      } else if (d?.type === 'sw-studio-click' && d.id) {
        setSelectedId(d.id);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
    // Mount-only listener: the 'ready' branch runs once (right after the iframe loads), so the
    // initial `selectedId` is correct there; ongoing selection highlighting is driven by the
    // effect above. (This project's eslint config does not register react-hooks/exhaustive-deps,
    // so no disable directive is needed here.)
  }, []);

  const download = () => {
    const blob = new Blob([svgText], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'animated.svg';
    document.body.appendChild(a); // Firefox needs the anchor in the DOM for a programmatic click to download
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const showOrigin = /^(scale|zoom|flip)/.test(effect);

  return (
    <Modal title="SVG animation studio" size="full" onClose={onClose}>
      {stage === 'import' ? (
        <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
          <p className="text-sm text-slate-500">
            Import an SVG — paste its markup or upload a <code>.svg</code>. Then assign an animation to each element and export
            the animated SVG. Pre-animated SVGs re-open with their settings intact.
          </p>
          <textarea
            aria-label="SVG markup"
            spellCheck={false}
            rows={12}
            placeholder="<svg …> … </svg>"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            className={`${glassInput} w-full font-mono text-xs`}
          />
          {importError && <p className="text-xs font-semibold text-red-600">{importError}</p>}
          <div className="flex items-center gap-3">
            <button type="button" className={primaryButton} onClick={() => doImport(pasteText)}>
              Import markup
            </button>
            <label className={`${ghostButton} cursor-pointer`}>
              Upload .svg
              <input type="file" accept=".svg,image/svg+xml" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
            {projectId && (
              <button type="button" className={ghostButton} onClick={() => setPickerOpen(true)}>
                Pick from media
              </button>
            )}
          </div>
          {projectId && pickerOpen && (
            <FilePicker projectId={projectId} accept={(a) => a.kind === 'image' && (a as { format?: string }).format === 'svg'} onPick={pickFromMedia} onClose={() => setPickerOpen(false)} />
          )}
        </div>
      ) : (
        <div className="flex h-full min-h-0">
          {/* element tree */}
          <div className="flex w-64 shrink-0 flex-col border-r border-slate-200">
            <div className="flex items-center justify-between px-3 py-2 text-xs font-bold text-slate-500">
              <span>Elements</span>
              <button type="button" className="text-[11px] font-semibold text-primary" onClick={() => setStage('import')}>
                ← re-import
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pb-3">
              <TreeList nodes={tree} selectedId={selectedId} onSelect={setSelectedId} svg={svgRef.current} />
            </div>
          </div>

          {/* canvas */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-2 px-3 py-2">
              <button type="button" className={primaryButton} onClick={() => send({ type: 'sw-studio-play' })}>
                ▶ Play
              </button>
              <span className="text-xs text-slate-400">{selectedId ? `selected: ${selectedId}` : 'click an element to select it'}</span>
            </div>
            <iframe ref={iframeRef} title="SVG studio canvas" src={previewSrc} sandbox="allow-scripts" className="min-h-0 flex-1 border-y border-slate-200 bg-white" />
            <div className="flex items-center gap-2 px-3 py-2">
              <button type="button" className={ghostButton} onClick={() => copy(svgText, 'svg-studio')}>
                Copy inline SVG
              </button>
              <button type="button" className={ghostButton} onClick={download}>
                Download .svg
              </button>
              {projectId &&
                (naming ? (
                  <span className="flex items-center gap-1">
                    <input aria-label="New file name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="animation" className={`${glassInput} w-32 text-xs`} />
                    <span className="text-xs text-slate-400">.svg</span>
                    <button type="button" className={primaryButton} onClick={saveNew}>Save</button>
                    <button type="button" className={ghostButton} onClick={() => setNaming(false)}>Cancel</button>
                  </span>
                ) : (
                  <>
                    {source && (
                      <button type="button" className={primaryButton} onClick={saveOverwrite}>
                        Save (overwrite {source.filename})
                      </button>
                    )}
                    <button type="button" className={source ? ghostButton : primaryButton} onClick={() => setNaming(true)}>
                      Save as new file
                    </button>
                  </>
                ))}
              {saveMsg && <span className="text-xs font-semibold text-emerald-600">{saveMsg}</span>}
            </div>
          </div>

          {/* per-element panel */}
          <div className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-slate-200 p-4">
            {!sel ? (
              <p className="text-sm text-slate-400">Select an element (in the tree or on the canvas) to animate it.</p>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="text-xs font-bold text-slate-500">
                  {sel.tagName.toLowerCase()} <span className="font-mono text-[11px] text-slate-400">#{selectedId}</span>
                </div>
                <Field label="Effect" desc="What this element does.">
                  <select aria-label="Effect" className={`${glassInput} text-xs`} value={effect} onChange={(e) => setEffect(e.target.value)}>
                    <option value="">— none —</option>
                    {SVG_ANIM_EFFECTS.map((e) => (
                      <option key={e} value={e}>
                        {EFFECT_LABELS[e] ?? e}
                      </option>
                    ))}
                  </select>
                </Field>
                {effect && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Duration" desc="ms">
                        <input aria-label="Duration" type="number" min={0} max={SVG_ANIM_LIMITS.duration.max} step={100} value={attr('data-sw-duration') || 600} onChange={(e) => setAttr('data-sw-duration', String(clampN(e.target.value, 0, SVG_ANIM_LIMITS.duration.max)))} className={`${glassInput} w-full`} />
                      </Field>
                      <Field label="Delay" desc="ms">
                        <input aria-label="Delay" type="number" min={0} max={SVG_ANIM_LIMITS.delay.max} step={50} value={attr('data-sw-delay') || 0} onChange={(e) => setAttr('data-sw-delay', num(e.target.value) > 0 ? String(clampN(e.target.value, 0, SVG_ANIM_LIMITS.delay.max)) : null)} className={`${glassInput} w-full`} />
                      </Field>
                    </div>
                    <Field label="Easing" desc="Timing curve.">
                      <select aria-label="Easing" className={`${glassInput} text-xs`} value={attr('data-sw-easing') || 'ease-out'} onChange={(e) => setAttr('data-sw-easing', e.target.value === 'ease-out' ? null : e.target.value)}>
                        {EASINGS.map((z) => (
                          <option key={z} value={z}>{z}</option>
                        ))}
                      </select>
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Direction" desc="Enter or exit.">
                        <select aria-label="Direction" className={`${glassInput} text-xs`} value={attr('data-sw-svg-dir') || 'in'} onChange={(e) => setAttr('data-sw-svg-dir', e.target.value === 'in' ? null : 'out')}>
                          <option value="in">In (enter)</option>
                          <option value="out">Out (exit)</option>
                        </select>
                      </Field>
                      <Field label="Trigger" desc="When it plays.">
                        <select aria-label="Trigger" className={`${glassInput} text-xs`} value={attr('data-sw-svg-trigger') || 'view'} onChange={(e) => setAttr('data-sw-svg-trigger', e.target.value === 'view' ? null : 'load')}>
                          <option value="view">On scroll-in</option>
                          <option value="load">On load</option>
                        </select>
                      </Field>
                    </div>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" className={toggleInput} checked={attr('data-sw-once') === 'false'} onChange={(e) => setAttr('data-sw-once', e.target.checked ? 'false' : null)} aria-label="Replay on every scroll-in" />
                      <span className="text-xs text-slate-600">Replay on every scroll-in (loop)</span>
                    </label>
                    {effect === 'draw' && (
                      <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 p-2">
                        <Field label="Stroke color" desc="draw outline">
                          <input aria-label="Stroke color" type="text" placeholder="currentColor" value={attr('data-sw-svg-draw-color')} onChange={(e) => setAttr('data-sw-svg-draw-color', e.target.value || null)} className={`${glassInput} w-full text-xs`} />
                        </Field>
                        <Field label="Stroke width" desc="px">
                          <input aria-label="Stroke width" type="number" min={0.5} step={0.5} value={attr('data-sw-svg-draw-width') || ''} onChange={(e) => setAttr('data-sw-svg-draw-width', e.target.value || null)} className={`${glassInput} w-full text-xs`} />
                        </Field>
                      </div>
                    )}
                    {effect === 'along-path' && (
                      <Field label="Motion path" desc="data-sw-svg-path">
                        <input aria-label="Motion path" type="text" spellCheck={false} placeholder="M10 60 Q60 -10 110 60" value={attr('data-sw-svg-path')} onChange={(e) => setAttr('data-sw-svg-path', e.target.value || null)} className={`${glassInput} w-full font-mono text-[11px]`} />
                      </Field>
                    )}
                    {effect === 'morph' && (
                      <Field label="Morph target" desc="data-sw-svg-to">
                        <textarea aria-label="Morph target" spellCheck={false} rows={2} placeholder="M12 2 L22 22 L2 22 Z" value={attr('data-sw-svg-to')} onChange={(e) => setAttr('data-sw-svg-to', e.target.value || null)} className={`${glassInput} w-full font-mono text-[11px]`} />
                      </Field>
                    )}
                    {showOrigin && (
                      <Field label="Pivot" desc="transform origin">
                        <select aria-label="Pivot" className={`${glassInput} text-xs`} value={attr('data-sw-svg-origin') || 'center'} onChange={(e) => setAttr('data-sw-svg-origin', e.target.value === 'center' ? null : e.target.value)}>
                          {['center', 'top', 'bottom', 'left', 'right', 'top left', 'top right', 'bottom left', 'bottom right'].map((o) => (
                            <option key={o} value={o}>{o}</option>
                          ))}
                        </select>
                      </Field>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

const num = (v: string): number => {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? 0 : n;
};
const clampN = (v: string, lo: number, hi: number): number => Math.max(lo, Math.min(hi, num(v)));

function Field({ label, desc, children }: { label: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="leading-tight">
        <span className="text-xs font-semibold text-slate-700">{label}</span>
        <span className="ml-1.5 text-[11px] text-slate-400">{desc}</span>
      </div>
      {children}
    </div>
  );
}

function TreeList({ nodes, selectedId, onSelect, svg }: { nodes: TreeNode[]; selectedId: string; onSelect: (id: string) => void; svg: SVGSVGElement | null }) {
  return (
    <ul>
      {nodes.map((n) => {
        const animated = !!svg?.querySelector(`[id="${cssEsc(n.id)}"]`)?.getAttribute('data-sw-svg');
        return (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => onSelect(n.id)}
              style={{ paddingLeft: 8 + n.depth * 14 }}
              className={`flex w-full items-center gap-1.5 py-1 pr-2 text-left text-xs ${selectedId === n.id ? 'bg-primary/10 font-semibold text-primary' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${animated ? 'bg-emerald-500' : 'bg-transparent'}`} />
              <span>{n.tag}</span>
              {n.authored && <span className="font-mono text-[10px] text-slate-400">#{n.id}</span>}
              {n.tag === 'g' && <span className="text-[10px] text-slate-400">({n.children.length})</span>}
            </button>
            {n.children.length > 0 && <TreeList nodes={n.children} selectedId={selectedId} onSelect={onSelect} svg={svg} />}
          </li>
        );
      })}
    </ul>
  );
}
