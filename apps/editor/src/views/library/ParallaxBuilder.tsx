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

/**
 * The Library "Parallax builder" — compose a scroll-linked element (translate speed + axis, plus optional
 * opacity / scale / blur channels), preview it live in a sandboxed, SCROLLABLE iframe driven by the EXACT
 * platform runtime, and copy the resulting `data-sw-parallax*` markup. Read-only (copy-to-clipboard).
 *
 * The preview is loaded by iframe `src` (NOT srcDoc) from a same-origin route served under
 * `Content-Security-Policy: sandbox allow-scripts` — that is what lets the inline runtime RUN: the
 * editor's own CSP is `script-src 'self'`, which a srcDoc iframe inherits and which would freeze the
 * engine (the original "preview shows no action on scroll" bug).
 */
export function ParallaxBuilder({ onClose }: ParallaxBuilderProps) {
  const [speed, setSpeed] = useState(0.3);
  const [axis, setAxis] = useState<'y' | 'x'>('y');
  const [opOn, setOpOn] = useState(false);
  const [op, setOp] = useState<[number, number]>([0, 1]);
  const [scOn, setScOn] = useState(false);
  const [sc, setSc] = useState<[number, number]>([0.9, 1.05]);
  const [blOn, setBlOn] = useState(false);
  const [bl, setBl] = useState<[number, number]>([8, 0]);
  const toast = useToast();
  const [, copy] = useCopy(() => toast.show('Parallax markup copied — paste it onto an element in your page'));

  // Omit channels that are off; omit axis when default (y). speed is always emitted (the headline knob).
  const attrs = [
    `data-sw-parallax="${speed}"`,
    axis === 'x' ? 'data-sw-parallax-axis="x"' : '',
    opOn ? `data-sw-parallax-opacity="${op[0]},${op[1]}"` : '',
    scOn ? `data-sw-parallax-scale="${sc[0]},${sc[1]}"` : '',
    blOn ? `data-sw-parallax-blur="${bl[0]},${bl[1]}"` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const code = `<div ${attrs}>\n  <!-- your content -->\n</div>`;

  // The same channel knobs as a query string; the server clamps them + renders the static-twin demo
  // (the "Parallax" box beside an un-animated "Static" one, so the subtle differential motion is legible).
  const previewSrc = useMemo(() => {
    const p = new URLSearchParams({ speed: String(speed) });
    if (axis === 'x') p.set('axis', 'x');
    if (opOn) p.set('opacity', `${op[0]},${op[1]}`);
    if (scOn) p.set('scale', `${sc[0]},${sc[1]}`);
    if (blOn) p.set('blur', `${bl[0]},${bl[1]}`);
    return api.parallaxPreviewUrl(p.toString());
  }, [speed, axis, opOn, op, scOn, sc, blOn, bl]);

  const Range = ({ label, value, set, lo, hi, step }: { label: string; value: number; set: (n: number) => void; lo: number; hi: number; step: number }) => (
    <label className="flex flex-col gap-1">
      <span className={fieldLabel}>
        {label} <span className="font-mono text-white/50">{value}</span>
      </span>
      <input type="range" min={lo} max={hi} step={step} value={value} onChange={(e) => set(num(e.target.value, value))} className="w-full accent-primary" />
    </label>
  );

  const FromTo = ({ on, setOn, label, pair, setPair, lo, hi, step }: { on: boolean; setOn: (b: boolean) => void; label: string; pair: [number, number]; setPair: (p: [number, number]) => void; lo: number; hi: number; step: number }) => (
    <div className="rounded-xl border border-white/10 p-3">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} className="accent-primary" />
        <span className={fieldLabel}>{label}</span>
      </label>
      {on && (
        <div className="mt-2 flex items-center gap-2">
          <input aria-label={`${label} from`} type="number" min={lo} max={hi} step={step} value={pair[0]} onChange={(e) => setPair([num(e.target.value, pair[0]), pair[1]])} className={`${glassInput} w-20`} />
          <span className="text-white/40">→</span>
          <input aria-label={`${label} to`} type="number" min={lo} max={hi} step={step} value={pair[1]} onChange={(e) => setPair([pair[0], num(e.target.value, pair[1])])} className={`${glassInput} w-20`} />
        </div>
      )}
    </div>
  );

  return (
    <Modal title="Parallax builder" size="full" onClose={onClose}>
      <div className="grid gap-6 p-5 md:grid-cols-[minmax(0,320px)_1fr]">
        {/* controls */}
        <div className="flex flex-col gap-4">
          <Range label="Speed" value={speed} set={setSpeed} lo={PARALLAX_LIMITS.speed.min} hi={PARALLAX_LIMITS.speed.max} step={0.05} />
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>Axis</span>
            <select aria-label="Parallax axis" className={glassInput} value={axis} onChange={(e) => setAxis(e.target.value as 'y' | 'x')}>
              <option value="y">Vertical (Y)</option>
              <option value="x">Horizontal (X)</option>
            </select>
          </label>
          <FromTo on={opOn} setOn={setOpOn} label="Opacity" pair={op} setPair={setOp} lo={PARALLAX_LIMITS.opacity.min} hi={PARALLAX_LIMITS.opacity.max} step={0.05} />
          <FromTo on={scOn} setOn={setScOn} label="Scale" pair={sc} setPair={setSc} lo={PARALLAX_LIMITS.scale.min} hi={PARALLAX_LIMITS.scale.max} step={0.05} />
          <FromTo on={blOn} setOn={setBlOn} label="Blur (px)" pair={bl} setPair={setBl} lo={PARALLAX_LIMITS.blur.min} hi={PARALLAX_LIMITS.blur.max} step={1} />
          <p className="text-xs text-white/45">Speed: 0 static · + recedes · − floats forward. Other channels interpolate from → to across the scroll. All motion is off under reduced motion.</p>
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
