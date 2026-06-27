import { useMemo, useState } from 'react';
import { PARALLAX_LIMITS } from '@sitewright/blocks';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';
import { useCopy } from '../ui/useCopy';
import { api } from '../../api';
import { glassInput, fieldLabel, ghostButton } from '../../theme';

interface ParallaxBuilderProps {
  onClose: () => void;
}

const num = (v: string, d: number): number => {
  const n = parseFloat(v);
  return Number.isNaN(n) ? d : n;
};

/** A scroll window over the element's viewport pass-through; null = inherit the element default. */
type Win = readonly [number, number] | null;
type Name = 'translate' | 'opacity' | 'scale' | 'blur';
const NAMES: readonly Name[] = ['translate', 'opacity', 'scale', 'blur'];

interface Chan {
  on: boolean;
  v: [number, number];
  /** IN window; null = inherit the element default. */
  win: Win;
  outOn: boolean;
  out: [number, number];
  /** OUT window; null = the remainder after IN. */
  outWin: Win;
}

const LIMITS: Record<Name, { lo: number; hi: number; step: number }> = {
  translate: { lo: PARALLAX_LIMITS.translate.min, hi: PARALLAX_LIMITS.translate.max, step: 5 },
  opacity: { lo: PARALLAX_LIMITS.opacity.min, hi: PARALLAX_LIMITS.opacity.max, step: 0.05 },
  scale: { lo: PARALLAX_LIMITS.scale.min, hi: PARALLAX_LIMITS.scale.max, step: 0.05 },
  blur: { lo: PARALLAX_LIMITS.blur.min, hi: PARALLAX_LIMITS.blur.max, step: 1 },
};

const CHANNEL_LABEL: Record<Name, string> = { translate: 'Move (px)', opacity: 'Opacity', scale: 'Scale', blur: 'Blur (px)' };

const PRESETS = { through: [0, 1] as const, centre: [0, 0.5] as const, late: [0.5, 1] as const };
type WinKey = 'inherit' | keyof typeof PRESETS | 'custom';

const winKey = (w: Win): WinKey => {
  if (w === null) return 'inherit';
  for (const k of Object.keys(PRESETS) as (keyof typeof PRESETS)[]) {
    if (PRESETS[k][0] === w[0] && PRESETS[k][1] === w[1]) return k;
  }
  return 'custom';
};
const keyToWin = (k: WinKey, prev: Win): Win => {
  if (k === 'inherit') return null;
  if (k === 'custom') return prev && winKey(prev) === 'custom' ? prev : [0, 0.5];
  return [...PRESETS[k]];
};

const newChan = (v: [number, number], on = false): Chan => ({ on, v, win: null, outOn: false, out: [v[1], v[0]], outWin: null });

// Two number inputs joined by →. Module-level so React keeps the inputs mounted (no focus loss while typing).
function NumPair({ label, pair, set, lo, hi, step }: { label: string; pair: [number, number]; set: (p: [number, number]) => void; lo: number; hi: number; step: number }) {
  return (
    <div className="flex items-center gap-2">
      <input aria-label={`${label} from`} type="number" min={lo} max={hi} step={step} value={pair[0]} onChange={(e) => set([num(e.target.value, pair[0]), pair[1]])} className={`${glassInput} w-20`} />
      <span className="text-white/40">→</span>
      <input aria-label={`${label} to`} type="number" min={lo} max={hi} step={step} value={pair[1]} onChange={(e) => set([pair[0], num(e.target.value, pair[1])])} className={`${glassInput} w-20`} />
    </div>
  );
}

// A window picker (preset select + custom start/end). `allowInherit` adds an "inherit element window" option.
function WindowSelect({ label, value, set, allowInherit }: { label: string; value: Win; set: (w: Win) => void; allowInherit: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <select aria-label={`${label} window`} className={`${glassInput} text-xs`} value={winKey(value)} onChange={(e) => set(keyToWin(e.target.value as WinKey, value))}>
        {allowInherit && <option value="inherit">Window: inherit</option>}
        <option value="through">Window: through view</option>
        <option value="centre">Window: reveal to centre</option>
        <option value="late">Window: late (after centre)</option>
        <option value="custom">Window: custom…</option>
      </select>
      {winKey(value) === 'custom' && value && (
        <div className="flex items-center gap-2">
          <input aria-label={`${label} window start`} type="number" min={0} max={1} step={0.05} value={value[0]} onChange={(e) => set([num(e.target.value, value[0]), value[1]])} className={`${glassInput} w-20`} />
          <span className="text-white/40">→</span>
          <input aria-label={`${label} window end`} type="number" min={0} max={1} step={0.05} value={value[1]} onChange={(e) => set([value[0], num(e.target.value, value[1])])} className={`${glassInput} w-20`} />
        </div>
      )}
    </div>
  );
}

// One effect's controls: enable + from→to (+ axis on translate) + window + (when the window leaves room) OUT.
function ChannelCard({
  name,
  ch,
  elWin,
  patch,
  axis,
  setAxis,
}: {
  name: Name;
  ch: Chan;
  elWin: readonly [number, number];
  patch: (name: Name, p: Partial<Chan>) => void;
  axis: 'y' | 'x';
  setAxis: (a: 'y' | 'x') => void;
}) {
  const label = CHANNEL_LABEL[name];
  const lim = LIMITS[name];
  const room = (ch.win ?? elWin)[1] < 1; // scroll left after the IN window for an OUT phase?
  return (
    <div className="rounded-xl border border-white/10 p-3">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={ch.on} onChange={(e) => patch(name, { on: e.target.checked })} className="accent-primary" />
        <span className={fieldLabel}>{label}</span>
      </label>
      {ch.on && (
        <div className="mt-2 flex flex-col gap-2">
          <NumPair label={label} pair={ch.v} set={(v) => patch(name, { v })} lo={lim.lo} hi={lim.hi} step={lim.step} />
          {name === 'translate' && (
            <select aria-label="Parallax axis" className={`${glassInput} text-xs`} value={axis} onChange={(e) => setAxis(e.target.value as 'y' | 'x')}>
              <option value="y">Axis: vertical (Y)</option>
              <option value="x">Axis: horizontal (X)</option>
            </select>
          )}
          <WindowSelect label={label} value={ch.win} set={(win) => patch(name, { win })} allowInherit />
          {room && (
            <label className="flex items-center gap-2 text-xs text-white/70">
              <input aria-label={`${label} animate out`} type="checkbox" checked={ch.outOn} onChange={(e) => patch(name, { outOn: e.target.checked })} className="accent-primary" />
              Animate back out
            </label>
          )}
          {room && ch.outOn && (
            <div className="ml-1 flex flex-col gap-2 border-l border-white/10 pl-2">
              <NumPair label={`${label} out`} pair={ch.out} set={(out) => patch(name, { out })} lo={lim.lo} hi={lim.hi} step={lim.step} />
              <WindowSelect label={`${label} out`} value={ch.outWin} set={(outWin) => patch(name, { outWin })} allowInherit />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The Library "Parallax builder" — compose a scroll-linked element: a from→to MOVE (px) plus optional
 * opacity / scale / blur, EACH anchored to its own window of the element's viewport pass-through, with an
 * optional OUT phase (in → hold → out) when the window leaves room. Preview it live in a sandboxed,
 * SCROLLABLE iframe driven by the EXACT platform runtime, and copy the `data-sw-parallax*` markup.
 *
 * The preview is loaded by iframe `src` (NOT srcDoc) from a same-origin route served under
 * `Content-Security-Policy: sandbox allow-scripts` — that is what lets the inline runtime RUN: the
 * editor's own CSP is `script-src 'self'`, which a srcDoc iframe inherits and which would freeze it.
 */
export function ParallaxBuilder({ onClose }: ParallaxBuilderProps) {
  const [axis, setAxis] = useState<'y' | 'x'>('y');
  const [elWin, setElWin] = useState<[number, number]>([0, 1]);
  const [chans, setChans] = useState<Record<Name, Chan>>({
    translate: newChan([40, -40], true),
    opacity: newChan([0, 1]),
    scale: newChan([0.9, 1.05]),
    blur: newChan([8, 0]),
  });
  const patch = (name: Name, p: Partial<Chan>) => setChans((c) => ({ ...c, [name]: { ...c[name], ...p } }));
  const toast = useToast();
  const [, copy] = useCopy(() => toast.show('Parallax markup copied — paste it onto an element in your page'));

  // Build the attribute list + the matching preview query string from the channel config. A channel's
  // window is emitted only when set (else it inherits the element window); OUT only when toggled AND the
  // IN window leaves room (effective end < 1) — mirroring the runtime + the builder's gating.
  const { code, previewSrc } = useMemo(() => {
    const elDefault = elWin[0] === 0 && elWin[1] === 1;
    const entries: [string, string][] = [];
    NAMES.forEach((name) => {
      const ch = chans[name];
      if (!ch.on) return;
      entries.push([name, `${ch.v[0]},${ch.v[1]}`]);
      if (ch.win) entries.push([`${name}-range`, `${ch.win[0]},${ch.win[1]}`]);
      if (ch.outOn && (ch.win ?? elWin)[1] < 1) {
        entries.push([`${name}-out`, `${ch.out[0]},${ch.out[1]}`]);
        if (ch.outWin) entries.push([`${name}-out-range`, `${ch.outWin[0]},${ch.outWin[1]}`]);
      }
    });
    if (axis === 'x' && chans.translate.on) entries.push(['axis', 'x']);
    if (!elDefault) entries.push(['range', `${elWin[0]},${elWin[1]}`]);
    const p = new URLSearchParams();
    entries.forEach(([k, v]) => p.set(k, v));
    const attrs = entries.map(([k, v]) => `data-sw-parallax-${k}="${v}"`).join(' ');
    return {
      code: `<div ${attrs}>\n  <!-- your content -->\n</div>`,
      previewSrc: api.parallaxPreviewUrl(p.toString()),
    };
  }, [chans, axis, elWin]);

  return (
    <Modal title="Parallax builder" size="full" onClose={onClose}>
      <div className="grid gap-6 p-5 md:grid-cols-[minmax(0,340px)_1fr]">
        {/* controls */}
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>Default window</span>
            <select aria-label="Default window" className={glassInput} value={winKey(elWin)} onChange={(e) => setElWin((keyToWin(e.target.value as WinKey, elWin) as [number, number]) ?? [0, 1])}>
              <option value="through">Through view (0–1)</option>
              <option value="centre">Reveal to centre (0–0.5)</option>
              <option value="late">Late (0.5–1)</option>
              <option value="custom">Custom…</option>
            </select>
            {winKey(elWin) === 'custom' && (
              <div className="mt-1 flex items-center gap-2">
                <input aria-label="Default window start" type="number" min={0} max={1} step={0.05} value={elWin[0]} onChange={(e) => setElWin([num(e.target.value, elWin[0]), elWin[1]])} className={`${glassInput} w-20`} />
                <span className="text-white/40">→</span>
                <input aria-label="Default window end" type="number" min={0} max={1} step={0.05} value={elWin[1]} onChange={(e) => setElWin([elWin[0], num(e.target.value, elWin[1])])} className={`${glassInput} w-20`} />
              </div>
            )}
          </label>
          {NAMES.map((name) => (
            <ChannelCard key={name} name={name} ch={chans[name]} elWin={elWin} patch={patch} axis={axis} setAxis={setAxis} />
          ))}
          <p className="text-xs text-white/45">
            Each effect runs from → to across its <strong>window</strong> of the element’s pass through the viewport (0 = entering, 0.5 = centred, 1 = leaving), then holds. A shorter window can add an OUT phase (in → hold → out). All motion is off under reduced motion.
          </p>
        </div>

        {/* preview + code */}
        <div className="flex min-w-0 flex-col gap-3">
          <iframe title="Parallax preview" src={previewSrc} className="block h-[380px] w-full rounded-xl border border-white/10 bg-white" sandbox="allow-scripts" />
          <div className="flex items-start gap-2">
            <pre className="min-w-0 flex-1 overflow-x-auto rounded-xl bg-black/40 p-3 text-xs text-white/80"><code>{code}</code></pre>
            <button type="button" className={`${ghostButton} shrink-0 whitespace-nowrap`} onClick={() => copy(code, 'px-builder')}>
              Copy markup
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
