import { useMemo, useState } from 'react';
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

type Name = 'translate' | 'opacity' | 'scale' | 'blur';
const NAMES: readonly Name[] = ['translate', 'opacity', 'scale', 'blur'];

/** A channel's anchor viewport: the whole pass-through, a reveal-while-in-view window, or a custom one. */
type Vp = 'through' | 'reveal' | 'custom';
const VP_WIN: Record<'through' | 'reveal', readonly [number, number]> = { through: [0, 1], reveal: [0, 0.5] };

interface Chan {
  on: boolean;
  v: [number, number];
  vp: Vp;
  /** custom IN window, used when vp === 'custom'. */
  vpc: [number, number];
  outOn: boolean;
  out: [number, number];
}

const LIMITS: Record<Name, { lo: number; hi: number; step: number }> = {
  translate: { lo: PARALLAX_LIMITS.translate.min, hi: PARALLAX_LIMITS.translate.max, step: 5 },
  opacity: { lo: PARALLAX_LIMITS.opacity.min, hi: PARALLAX_LIMITS.opacity.max, step: 0.05 },
  scale: { lo: PARALLAX_LIMITS.scale.min, hi: PARALLAX_LIMITS.scale.max, step: 0.05 },
  blur: { lo: PARALLAX_LIMITS.blur.min, hi: PARALLAX_LIMITS.blur.max, step: 1 },
};

const CHANNEL_LABEL: Record<Name, string> = { translate: 'Motion (px)', opacity: 'Opacity', scale: 'Scale', blur: 'Blur (px)' };

// The effective IN window. A custom window is normalised (endpoints ordered) so an inverted entry
// (start > end) can never emit an `-out` without a matching `-range`.
const inWin = (c: Chan): readonly [number, number] =>
  c.vp === 'custom' ? [Math.min(c.vpc[0], c.vpc[1]), Math.max(c.vpc[0], c.vpc[1])] : VP_WIN[c.vp];
const newChan = (v: [number, number], on = false): Chan => ({ on, v, vp: 'through', vpc: [0, 0.5], outOn: false, out: [v[1], v[0]] });

// Two validated number inputs joined by →. Module-level so React keeps the inputs mounted (no focus loss).
// Values are CLAMPED to [lo,hi] on change (e.g. opacity stays 0–1).
function NumPair({ label, pair, set, lo, hi, step }: { label: string; pair: [number, number]; set: (p: [number, number]) => void; lo: number; hi: number; step: number }) {
  const edit = (i: 0 | 1, raw: string) => {
    const next: [number, number] = [pair[0], pair[1]];
    next[i] = clamp(num(raw, pair[i]), lo, hi);
    set(next);
  };
  return (
    <div className="flex items-center gap-2">
      <input aria-label={`${label} from`} type="number" min={lo} max={hi} step={step} value={pair[0]} onChange={(e) => edit(0, e.target.value)} className={`${glassInput} w-20`} />
      <span className="text-slate-400">→</span>
      <input aria-label={`${label} to`} type="number" min={lo} max={hi} step={step} value={pair[1]} onChange={(e) => edit(1, e.target.value)} className={`${glassInput} w-20`} />
    </div>
  );
}

// One effect's controls: a toggle + from→to (+ axis on Motion) + a Viewport picker + (when the window
// leaves room) an "animate back out" toggle.
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
  const room = inWin(ch)[1] < 1; // scroll left after the IN window for an OUT phase?
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <label className="flex items-center gap-2">
        <input type="checkbox" className={toggleInput} checked={ch.on} onChange={(e) => patch(name, { on: e.target.checked })} aria-label={label} />
        <span className="text-xs font-semibold text-slate-700">{label}</span>
      </label>
      {ch.on && (
        <div className="mt-2.5 flex flex-col gap-2">
          <NumPair label={label} pair={ch.v} set={(v) => patch(name, { v })} lo={lim.lo} hi={lim.hi} step={lim.step} />
          {name === 'translate' && (
            <select aria-label="Parallax axis" className={`${glassInput} text-xs`} value={axis} onChange={(e) => setAxis(e.target.value as 'y' | 'x')}>
              <option value="y">Axis: vertical (Y)</option>
              <option value="x">Axis: horizontal (X)</option>
            </select>
          )}
          <select aria-label={`${label} viewport`} className={`${glassInput} text-xs`} value={ch.vp} onChange={(e) => patch(name, { vp: e.target.value as Vp })}>
            <option value="through">Viewport: through view</option>
            <option value="reveal">Viewport: reveal (in view)</option>
            <option value="custom">Viewport: custom…</option>
          </select>
          {ch.vp === 'custom' && (
            <div className="flex items-center gap-2">
              <input aria-label={`${label} viewport start`} type="number" min={0} max={1} step={0.05} value={ch.vpc[0]} onChange={(e) => patch(name, { vpc: [clamp(num(e.target.value, ch.vpc[0]), 0, 1), ch.vpc[1]] })} className={`${glassInput} w-20`} />
              <span className="text-slate-400">→</span>
              <input aria-label={`${label} viewport end`} type="number" min={0} max={1} step={0.05} value={ch.vpc[1]} onChange={(e) => patch(name, { vpc: [ch.vpc[0], clamp(num(e.target.value, ch.vpc[1]), 0, 1)] })} className={`${glassInput} w-20`} />
            </div>
          )}
          {room && (
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" className={toggleInput} checked={ch.outOn} onChange={(e) => patch(name, { outOn: e.target.checked })} aria-label={`${label} animate out`} />
              Animate back out
            </label>
          )}
          {room && ch.outOn && (
            <div className="ml-1 border-l border-slate-200 pl-2">
              <NumPair label={`${label} out`} pair={ch.out} set={(out) => patch(name, { out })} lo={lim.lo} hi={lim.hi} step={lim.step} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The Library "Parallax builder" — compose a scroll-linked element: a from→to MOTION (px) plus optional
 * opacity / scale / blur, EACH anchored to its own Viewport window of the element's pass-through (0 =
 * entering, 0.5 = centred, 1 = leaving), with an optional OUT phase (in → hold → out) when the window
 * leaves room. Preview it live in a sandboxed, SCROLLABLE iframe driven by the EXACT platform runtime.
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

  // Build the attribute list + matching preview query. A channel emits its own -range only when its
  // viewport isn't the full pass-through; OUT only when toggled AND the window leaves room (end < 1).
  const { code, previewSrc } = useMemo(() => {
    const entries: [string, string][] = [];
    NAMES.forEach((name) => {
      const ch = chans[name];
      if (!ch.on) return;
      entries.push([name, `${ch.v[0]},${ch.v[1]}`]);
      const w = inWin(ch);
      if (w[1] > w[0] && !(w[0] === 0 && w[1] === 1)) entries.push([`${name}-range`, `${w[0]},${w[1]}`]);
      if (ch.outOn && w[1] < 1) entries.push([`${name}-out`, `${ch.out[0]},${ch.out[1]}`]);
    });
    if (axis === 'x' && chans.translate.on) entries.push(['axis', 'x']);
    const p = new URLSearchParams();
    entries.forEach(([k, v]) => p.set(k, v));
    const attrs = entries.map(([k, v]) => `data-sw-parallax-${k}="${v}"`).join(' ');
    return {
      code: `<div ${attrs}>\n  <!-- your content -->\n</div>`,
      previewSrc: api.parallaxPreviewUrl(p.toString()),
    };
  }, [chans, axis]);

  return (
    <Modal title="Parallax builder" size="full" onClose={onClose}>
      <div className="flex h-full min-h-0 gap-6 p-5">
        {/* controls — independently scrollable so the preview stays in view */}
        <div className="flex w-[340px] min-h-0 shrink-0 flex-col gap-4 overflow-y-auto pr-1">
          {NAMES.map((name) => (
            <ChannelCard key={name} name={name} ch={chans[name]} patch={patch} axis={axis} setAxis={setAxis} />
          ))}
          <p className="text-xs text-slate-500">
            Each effect runs from → to across its <strong>Viewport</strong> window of the element’s pass through the screen (0 = entering, 0.5 = centred, 1 = leaving), then holds. A shorter window can add an OUT phase (in → hold → out). All motion is off under reduced motion.
          </p>
        </div>

        {/* preview + code */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <iframe title="Parallax preview" src={previewSrc} className="block h-[380px] w-full rounded-xl border border-slate-200 bg-white" sandbox="allow-scripts" />
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
