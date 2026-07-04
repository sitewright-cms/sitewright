import { useEffect, useMemo, useRef, useState } from 'react';
import { SVG_ANIM_EFFECTS, SVG_ANIM_LIMITS } from '@sitewright/blocks';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';
import { useCopy } from '../ui/useCopy';
import { api } from '../../api';
import { glassInput, ghostButton, toggleInput } from '../../theme';

interface SvgAnimBuilderProps {
  onClose: () => void;
}

const clamp = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n);
const int = (v: string, d: number): number => {
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? d : n;
};

const EFFECT_LABELS: Record<string, string> = {
  draw: 'Draw on (stroke)',
  fade: 'Fade in',
  'fade-up': 'Fade up',
  'fade-down': 'Fade down',
  'fade-left': 'Fade left',
  'fade-right': 'Fade right',
  'zoom-in': 'Zoom in',
  'zoom-out': 'Zoom out',
  'flip-x': 'Flip (X axis)',
  'flip-y': 'Flip (Y axis)',
  blur: 'Blur in',
};
const EASINGS = ['ease-out', 'ease', 'ease-in', 'ease-in-out', 'linear', 'back', 'bounce', 'elastic'] as const;
const ORIGINS = ['center', 'top', 'bottom', 'left', 'right', 'top left', 'top right', 'bottom left', 'bottom right'] as const;
const originEffects = new Set(['zoom-in', 'zoom-out', 'flip-x', 'flip-y']);

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

/**
 * The Library "SVG animation builder" — compose an entrance for an SVG element: an effect (draw-on,
 * fade/zoom/flip/blur) plus the shared timing (duration / delay / easing) and, for draw, direction +
 * fill. Preview it live (looping) in a sandboxed iframe driven by the EXACT platform runtime, and copy
 * the `data-sw-svg*` attributes onto any element inside your SVG.
 *
 * The preview loads by iframe `src` (NOT srcDoc) from a same-origin route served under
 * `Content-Security-Policy: sandbox allow-scripts` — that is what lets the inline runtime RUN.
 */
export function SvgAnimBuilder({ onClose }: SvgAnimBuilderProps) {
  const [effect, setEffect] = useState<string>('draw');
  const [duration, setDuration] = useState(1200);
  const [delay, setDelay] = useState(0);
  const [easing, setEasing] = useState<string>('ease-out');
  const [trigger, setTrigger] = useState<'view' | 'load'>('view');
  const [drawDir, setDrawDir] = useState<'normal' | 'reverse'>('normal');
  const [fill, setFill] = useState(false);
  const [origin, setOrigin] = useState<string>('center');
  const toast = useToast();
  const [, copy] = useCopy(() => toast.show('SVG animation markup copied — paste it onto an element inside your SVG'));

  // The preview attributes (LIVE, pushed via postMessage) — kept minimal (only non-default knobs) so the
  // emitted markup stays clean.
  const previewEntries = useMemo<[string, string][]>(() => {
    const e: [string, string][] = [
      ['data-sw-svg', effect],
      ['data-sw-duration', String(clamp(duration, SVG_ANIM_LIMITS.duration.min, SVG_ANIM_LIMITS.duration.max))],
    ];
    if (delay > 0) e.push(['data-sw-delay', String(clamp(delay, SVG_ANIM_LIMITS.delay.min, SVG_ANIM_LIMITS.delay.max))]);
    if (easing !== 'ease-out') e.push(['data-sw-easing', easing]);
    if (effect === 'draw' && drawDir === 'reverse') e.push(['data-sw-svg-draw-dir', 'reverse']);
    if (effect === 'draw' && fill) e.push(['data-sw-svg-fill', 'true']);
    if (originEffects.has(effect) && origin !== 'center') e.push(['data-sw-svg-origin', origin]);
    return e;
  }, [effect, duration, delay, easing, drawDir, fill, origin]);

  // The emitted copy-paste markup adds the trigger (a page concern, not shown in the looping preview).
  const code = useMemo(() => {
    const attrs = [...previewEntries.map(([k, v]) => `${k}="${v}"`), ...(trigger === 'load' ? ['data-sw-svg-trigger="load"'] : [])].join(' ');
    return effect === 'draw'
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">\n  <path ${attrs} d="M4 12 L10 18 L20 6" />\n</svg>`
      : `<svg viewBox="0 0 24 24">\n  <path ${attrs} d="…your artwork…" />\n</svg>`;
  }, [previewEntries, trigger, effect]);

  // Load the preview ONCE (static src); push config via postMessage so the iframe never reloads. The
  // preview posts 'sw-svg-ready' when its listener is live; we (re)send on ready and on every change.
  const previewSrc = useMemo(() => api.svgAnimPreviewUrl(''), []);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const readyRef = useRef(false);
  const entriesRef = useRef(previewEntries);
  entriesRef.current = previewEntries;
  useEffect(() => {
    if (readyRef.current) iframeRef.current?.contentWindow?.postMessage({ type: 'sw-svg', entries: previewEntries }, '*');
  }, [previewEntries]);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if ((e.data as { type?: string } | null)?.type === 'sw-svg-ready') {
        readyRef.current = true;
        iframeRef.current?.contentWindow?.postMessage({ type: 'sw-svg', entries: entriesRef.current }, '*');
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  return (
    <Modal title="SVG animation builder" size="full" onClose={onClose}>
      <div className="flex h-full min-h-0 gap-6 p-5">
        {/* controls */}
        <div className="flex w-[340px] min-h-0 shrink-0 flex-col gap-4 overflow-y-auto pr-1">
          <Field label="Effect" desc="How the element enters.">
            <select aria-label="SVG effect" className={`${glassInput} text-xs`} value={effect} onChange={(e) => setEffect(e.target.value)}>
              {SVG_ANIM_EFFECTS.map((ef) => (
                <option key={ef} value={ef}>
                  {EFFECT_LABELS[ef] ?? ef}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Duration (ms)" desc="Length.">
              <input
                aria-label="Duration"
                type="number"
                min={SVG_ANIM_LIMITS.duration.min}
                max={SVG_ANIM_LIMITS.duration.max}
                step={100}
                value={duration}
                onChange={(e) => setDuration(clamp(int(e.target.value, duration), SVG_ANIM_LIMITS.duration.min, SVG_ANIM_LIMITS.duration.max))}
                className={`${glassInput} w-full`}
              />
            </Field>
            <Field label="Delay (ms)" desc="Wait before.">
              <input
                aria-label="Delay"
                type="number"
                min={SVG_ANIM_LIMITS.delay.min}
                max={SVG_ANIM_LIMITS.delay.max}
                step={50}
                value={delay}
                onChange={(e) => setDelay(clamp(int(e.target.value, delay), SVG_ANIM_LIMITS.delay.min, SVG_ANIM_LIMITS.delay.max))}
                className={`${glassInput} w-full`}
              />
            </Field>
          </div>
          <Field label="Easing" desc="Timing curve.">
            <select aria-label="Easing" className={`${glassInput} text-xs`} value={easing} onChange={(e) => setEasing(e.target.value)}>
              {EASINGS.map((ez) => (
                <option key={ez} value={ez}>
                  {ez}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Trigger" desc="Play on scroll-in (view) or at load.">
            <select aria-label="Trigger" className={`${glassInput} text-xs`} value={trigger} onChange={(e) => setTrigger(e.target.value as 'view' | 'load')}>
              <option value="view">On scroll into view</option>
              <option value="load">On page load</option>
            </select>
          </Field>
          {effect === 'draw' && (
            <div className="flex flex-col gap-3 rounded-xl border border-slate-200 p-3">
              <Field label="Draw direction" desc="Which end the stroke draws from.">
                <select aria-label="Draw direction" className={`${glassInput} text-xs`} value={drawDir} onChange={(e) => setDrawDir(e.target.value as 'normal' | 'reverse')}>
                  <option value="normal">Normal</option>
                  <option value="reverse">Reverse</option>
                </select>
              </Field>
              <label className="flex items-center gap-2">
                <input type="checkbox" className={toggleInput} checked={fill} onChange={(e) => setFill(e.target.checked)} aria-label="Fade fill in after draw" />
                <span className="text-xs text-slate-600">Fade the fill in after the stroke draws</span>
              </label>
            </div>
          )}
          {originEffects.has(effect) && (
            <Field label="Pivot" desc="Transform origin for scale/flip.">
              <select aria-label="Pivot" className={`${glassInput} text-xs`} value={origin} onChange={(e) => setOrigin(e.target.value)}>
                {ORIGINS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <p className="text-xs text-slate-500">
            Put these attributes on any element inside an SVG (a <code>&lt;path&gt;</code>, <code>&lt;g&gt;</code>, or shape). Wrap several in{' '}
            <code>data-sw-svg-scene</code> with <code>data-sw-svg-stagger="80"</code> to cascade them. All motion is off under reduced motion.
          </p>
        </div>

        {/* preview + code */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <iframe ref={iframeRef} title="SVG animation preview" src={previewSrc} className="block h-[380px] w-full rounded-xl border border-slate-200 bg-white" sandbox="allow-scripts" />
          <div className="flex items-start gap-2">
            <pre className="min-w-0 flex-1 overflow-x-auto rounded-xl bg-neutral-900 p-3 text-xs leading-relaxed text-slate-100">
              <code>{code}</code>
            </pre>
            <button type="button" className={`${ghostButton} shrink-0 whitespace-nowrap`} onClick={() => copy(code, 'svg-builder')}>
              Copy markup
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
