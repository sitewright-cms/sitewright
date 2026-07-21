import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PARALLAX_LIMITS } from '@sitewright/blocks';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';
import { useCopy } from '../ui/useCopy';
import { api } from '../../api';
import { glassInput, ghostButton, toggleInput } from '../../theme';

interface ParallaxBuilderProps {
  onClose: () => void;
}

const clamp = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n);
const num = (v: string, d: number): number => {
  const n = parseFloat(v);
  return Number.isNaN(n) ? d : n;
};
/** A percentage (0–100, builder UI) → a cover-fraction string (0–1, the engine attribute), float-noise free. */
const frac = (pct: number): string => String(+(pct / 100).toFixed(4));

type Name = 'translate' | 'opacity' | 'scale' | 'blur';
const NAMES: readonly Name[] = ['translate', 'opacity', 'scale', 'blur'];

/** A channel's anchor viewport: the whole pass-through, reveal-by-centre, or a custom window (%). */
type Vp = 'through' | 'center' | 'custom';
const VP_PCT: Record<'through' | 'center', readonly [number, number]> = { through: [0, 100], center: [0, 50] };

interface Chan {
  on: boolean;
  v: [number, number];
  vp: Vp;
  /** custom IN window in PERCENT, used when vp === 'custom'. */
  vpc: [number, number];
  outOn: boolean;
  /** OUT 'to' value (OUT 'from' is locked to the IN 'to' = v[1]). */
  outTo: number;
  /** OUT window in PERCENT; start is held ≥ the IN end (the gap is the HOLD range). */
  outWin: [number, number];
}

const LIMITS: Record<Name, { lo: number; hi: number; step: number }> = {
  translate: { lo: PARALLAX_LIMITS.translate.min, hi: PARALLAX_LIMITS.translate.max, step: 5 },
  opacity: { lo: PARALLAX_LIMITS.opacity.min, hi: PARALLAX_LIMITS.opacity.max, step: 0.05 },
  scale: { lo: PARALLAX_LIMITS.scale.min, hi: PARALLAX_LIMITS.scale.max, step: 0.05 },
  blur: { lo: PARALLAX_LIMITS.blur.min, hi: PARALLAX_LIMITS.blur.max, step: 1 },
};
const CHANNEL_LABEL: Record<Name, string> = { translate: 'Motion (px)', opacity: 'Opacity', scale: 'Scale', blur: 'Blur (px)' };
const CHANNEL_DESC: Record<Name, string> = {
  translate: 'Slide the element between two pixel offsets.',
  opacity: 'Fade between two opacity values (0–1).',
  scale: 'Scale between two factors (1 = natural size).',
  blur: 'Blur between two radii, in pixels.',
};

const inPct = (c: Chan): [number, number] =>
  c.vp === 'custom' ? [Math.min(c.vpc[0], c.vpc[1]), Math.max(c.vpc[0], c.vpc[1])] : [...VP_PCT[c.vp]];
/** Effective OUT window (%): start never before the IN end, end never before the start. */
const outPct = (c: Chan): [number, number] => {
  const inEnd = inPct(c)[1];
  const s = Math.min(Math.max(c.outWin[0], inEnd), 100);
  const e = Math.min(Math.max(c.outWin[1], s), 100);
  return [s, e];
};
const newChan = (v: [number, number], on = false): Chan => ({ on, v, vp: 'through', vpc: [0, 50], outOn: false, outTo: v[0], outWin: [50, 100] });

// A labelled field group with a short description, so every control reads on its own. Module-level so
// React keeps inputs mounted (no focus loss while typing).
function Field({ label, desc, children }: { label: string; desc: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="leading-tight">
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{label}</span>
        <span className="ml-1.5 text-[11px] text-slate-400 dark:text-slate-500">{desc}</span>
      </div>
      {children}
    </div>
  );
}

// A single CLAMPED number input.
function NumInput({ aria, value, set, lo, hi, step, disabled }: { aria: string; value: number; set?: (n: number) => void; lo: number; hi: number; step: number; disabled?: boolean }) {
  return (
    <input
      aria-label={aria}
      type="number"
      min={lo}
      max={hi}
      step={step}
      value={value}
      disabled={disabled}
      onChange={set ? (e) => set(clamp(num(e.target.value, value), lo, hi)) : undefined}
      className={`${glassInput} w-20${disabled ? ' opacity-60' : ''}`}
    />
  );
}
const Arrow = () => <span className="text-slate-400 dark:text-slate-500">→</span>;

// One effect's controls: a toggle + from→to (+ axis on Motion) + a Viewport range, and — when the
// window leaves room — an OUT phase (locked 'from', its own viewport for a HOLD range, and a 'to').
function ChannelCard({
  name,
  ch,
  patch,
  axis,
  setAxis,
}: {
  name: Name;
  ch: Chan;
  patch: (name: Name, p: Partial<Chan>) => void;
  axis: 'y' | 'x';
  setAxis: (a: 'y' | 'x') => void;
}) {
  const label = CHANNEL_LABEL[name];
  const lim = LIMITS[name];
  const inEnd = inPct(ch)[1];
  const room = inEnd < 100; // scroll left after the IN range for an OUT phase?
  const [os, oe] = outPct(ch);
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
      <label className="flex items-start gap-2">
        <input type="checkbox" className={`${toggleInput} mt-0.5`} checked={ch.on} onChange={(e) => patch(name, { on: e.target.checked })} aria-label={label} />
        <span className="leading-tight">
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{label}</span>
          <span className="block text-[11px] text-slate-400 dark:text-slate-500">{CHANNEL_DESC[name]}</span>
        </span>
      </label>
      {ch.on && (
        <div className="mt-3 flex flex-col gap-3">
          <Field label="From → to" desc="Start and end value as it scrolls.">
            <div className="flex items-center gap-2">
              <NumInput aria={`${label} from`} value={ch.v[0]} set={(n) => patch(name, { v: [n, ch.v[1]] })} lo={lim.lo} hi={lim.hi} step={lim.step} />
              <Arrow />
              <NumInput aria={`${label} to`} value={ch.v[1]} set={(n) => patch(name, { v: [ch.v[0], n] })} lo={lim.lo} hi={lim.hi} step={lim.step} />
            </div>
          </Field>
          {name === 'translate' && (
            <Field label="Axis" desc="Direction of the move.">
              <select aria-label="Parallax axis" className={`${glassInput} text-xs`} value={axis} onChange={(e) => setAxis(e.target.value as 'y' | 'x')}>
                <option value="y">Vertical (Y)</option>
                <option value="x">Horizontal (X)</option>
              </select>
            </Field>
          )}
          <Field label="Viewport" desc="Scroll range it plays over — 0% enter · 50% centre · 100% leave.">
            <select aria-label={`${label} viewport`} className={`${glassInput} text-xs`} value={ch.vp} onChange={(e) => patch(name, { vp: e.target.value as Vp })}>
              <option value="through">Bottom To Top (0% → 100%)</option>
              <option value="center">Bottom To Center (0% → 50%)</option>
              <option value="custom">Custom (%)</option>
            </select>
            {ch.vp === 'custom' && (
              <div className="mt-2 flex items-center gap-2">
                <NumInput aria={`${label} viewport from`} value={ch.vpc[0]} set={(n) => patch(name, { vpc: [n, ch.vpc[1]] })} lo={0} hi={100} step={5} />
                <Arrow />
                <NumInput aria={`${label} viewport to`} value={ch.vpc[1]} set={(n) => patch(name, { vpc: [ch.vpc[0], n] })} lo={0} hi={100} step={5} />
                <span className="text-[11px] text-slate-400 dark:text-slate-500">%</span>
              </div>
            )}
          </Field>
          {room && (
            <Field label="Animate back out" desc="Reverse the effect later, after an optional hold.">
              <label className="flex items-center gap-2">
                <input type="checkbox" className={toggleInput} checked={ch.outOn} onChange={(e) => patch(name, { outOn: e.target.checked, ...(e.target.checked ? { outWin: [inEnd, 100] as [number, number] } : {}) })} aria-label={`${label} animate out`} />
                <span className="text-xs text-slate-600 dark:text-slate-300">{ch.outOn ? 'On' : 'Off'}</span>
              </label>
            </Field>
          )}
          {room && ch.outOn && (
            <div className="ml-1 flex flex-col gap-3 border-l-2 border-slate-200 dark:border-slate-700 pl-3">
              <Field label="Out: from → to" desc="‘From’ is locked to the In ‘to’; set where it ends.">
                <div className="flex items-center gap-2">
                  <NumInput aria={`${label} out from`} value={ch.v[1]} lo={lim.lo} hi={lim.hi} step={lim.step} disabled />
                  <Arrow />
                  <NumInput aria={`${label} out to`} value={ch.outTo} set={(n) => patch(name, { outTo: n })} lo={lim.lo} hi={lim.hi} step={lim.step} />
                </div>
              </Field>
              <Field label="Out viewport (%)" desc="Holds from the In end until ‘out’ starts, then plays out.">
                <div className="flex items-center gap-2">
                  <NumInput aria={`${label} out from-range`} value={os} set={(n) => patch(name, { outWin: [clamp(n, inEnd, 100), ch.outWin[1]] })} lo={inEnd} hi={100} step={5} />
                  <Arrow />
                  <NumInput aria={`${label} out to-range`} value={oe} set={(n) => patch(name, { outWin: [ch.outWin[0], clamp(n, os, 100)] })} lo={os} hi={100} step={5} />
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">%</span>
                </div>
              </Field>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The Library "Parallax builder" — compose a scroll-linked element: a from→to MOTION (px) plus optional
 * opacity / scale / blur, EACH anchored to its own Viewport range of the element's pass-through (in
 * percent: 0% entering, 50% centred, 100% leaving), with an optional OUT phase (in → HOLD → out). Preview
 * it live in a sandboxed, SCROLLABLE iframe driven by the EXACT platform runtime.
 *
 * The preview is loaded by iframe `src` (NOT srcDoc) from a same-origin route served under
 * `Content-Security-Policy: sandbox allow-scripts` — that is what lets the inline runtime RUN: the
 * editor's own CSP is `script-src 'self'`, which a srcDoc iframe inherits and which would freeze it.
 */
export function ParallaxBuilder({ onClose }: ParallaxBuilderProps) {
  const [axis, setAxis] = useState<'y' | 'x'>('y');
  const [chans, setChans] = useState<Record<Name, Chan>>({
    translate: newChan([40, -40], true),
    opacity: newChan([0, 1]),
    scale: newChan([0.9, 1.05]),
    blur: newChan([8, 0]),
  });
  const patch = (name: Name, p: Partial<Chan>) => setChans((c) => ({ ...c, [name]: { ...c[name], ...p } }));
  const toast = useToast();
  const [, copy] = useCopy(() => toast.show('Parallax markup copied — paste it onto an element in your page'));

  // Build the attribute list. The UI is in %, the emitted -range is a 0–1 cover-fraction. A channel emits
  // -range only when its viewport isn't the full pass-through; OUT (its 'from' locked to the IN 'to', plus
  // an -out-range that creates the HOLD) only when toggled + room left.
  const { code, entries } = useMemo(() => {
    const list: [string, string][] = [];
    NAMES.forEach((name) => {
      const ch = chans[name];
      if (!ch.on) return;
      list.push([name, `${ch.v[0]},${ch.v[1]}`]);
      const [s, e] = inPct(ch);
      if (!(s === 0 && e === 100)) list.push([`${name}-range`, `${frac(s)},${frac(e)}`]);
      if (ch.outOn && e < 100) {
        const [os, oe] = outPct(ch);
        if (oe > os) {
          // skip a degenerate (zero-width) OUT window so the markup never diverges from the engine
          list.push([`${name}-out`, `${ch.v[1]},${ch.outTo}`]);
          list.push([`${name}-out-range`, `${frac(os)},${frac(oe)}`]);
        }
      }
    });
    if (axis === 'x' && chans.translate.on) list.push(['axis', 'x']);
    const attrs = list.map(([k, v]) => `data-sw-parallax-${k}="${v}"`).join(' ');
    return { code: `<div ${attrs}>\n  <!-- your content -->\n</div>`, entries: list };
  }, [chans, axis]);

  // The preview iframe loads ONCE (static src); config updates are pushed via postMessage so the iframe
  // never reloads and the SCROLL POSITION is preserved while tweaking values. The preview posts
  // 'sw-px-ready' when its listener is live; we (re)send on ready and on every change.
  const previewSrc = useMemo(() => api.parallaxPreviewUrl(''), []);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const readyRef = useRef(false);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  useEffect(() => {
    if (readyRef.current) iframeRef.current?.contentWindow?.postMessage({ type: 'sw-px', entries }, '*');
  }, [entries]);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return; // only our preview iframe
      if ((e.data as { type?: string } | null)?.type === 'sw-px-ready') {
        readyRef.current = true;
        iframeRef.current?.contentWindow?.postMessage({ type: 'sw-px', entries: entriesRef.current }, '*');
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  return (
    <Modal title="Parallax builder" size="full" onClose={onClose}>
      <div className="flex h-full min-h-0 gap-6 p-5">
        {/* controls — independently scrollable so the preview stays in view */}
        <div className="flex w-[360px] min-h-0 shrink-0 flex-col gap-4 overflow-y-auto pr-1">
          {NAMES.map((name) => (
            <ChannelCard key={name} name={name} ch={chans[name]} patch={patch} axis={axis} setAxis={setAxis} />
          ))}
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Each effect runs from → to across its Viewport range of the element’s pass through the screen (0% entering · 50% centred · 100% leaving), then holds. Turn on “Animate back out” to reverse it later — the gap between the in-range end and the out-range start is a <strong>hold</strong> where nothing changes. All motion is off under reduced motion.
          </p>
        </div>

        {/* preview + code */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <iframe ref={iframeRef} title="Parallax preview" src={previewSrc} className="block h-[380px] w-full rounded-xl border border-slate-200 bg-white" sandbox="allow-scripts" />
          <div className="flex items-start gap-2">
            <pre className="min-w-0 flex-1 overflow-x-auto rounded-xl bg-neutral-900 p-3 text-xs leading-relaxed text-slate-100"><code>{code}</code></pre>
            <button type="button" className={`${ghostButton} shrink-0 whitespace-nowrap`} onClick={() => copy(code, 'px-builder')}>
              Copy markup
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
