import { useEffect, useMemo, useState } from 'react';
import { PARALLAX_LIMITS } from '@sitewright/blocks';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';
import { useCopy } from '../ui/useCopy';
import { api } from '../../api';
import { glassInput, fieldLabel, ghostButton } from '../../theme';

// The platform's contentColorFor crossover (WCAG luminance) — for the on-brand preview sample.
function contentFor(hex: string): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#ffffff';
  const h = m[1]!.length === 3 ? m[1]!.replace(/(.)/g, '$1$1') : m[1]!;
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const r = lin(parseInt(h.slice(0, 2), 16) / 255);
  const g = lin(parseInt(h.slice(2, 4), 16) / 255);
  const b = lin(parseInt(h.slice(4, 6), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? '#1f2937' : '#ffffff';
}

// Best-effort project brand vars for the preview iframe (only fully-matched hex/rgb is trusted before
// being interpolated into the iframe <style> — no `;`/`<`/`}` break-out chars).
function brandVarsFromDom(): string {
  const root = getComputedStyle(document.documentElement);
  const DEFAULTS: Record<string, string> = { primary: '#4f46e5', secondary: '#0ea5e9', neutral: '#171627', 'base-100': '#ffffff', 'base-content': '#1a1a23' };
  const read = (role: string): string => {
    const raw = root.getPropertyValue(`--sw-color-${role}`).trim();
    return /^#[0-9a-fA-F]{3,8}$/.test(raw) || /^rgba?\([0-9\s,./%]+\)$/i.test(raw) ? raw : DEFAULTS[role]!;
  };
  let v = '';
  for (const role of ['primary', 'secondary', 'neutral'] as const) {
    const c = read(role);
    v += `--sw-color-${role}:${c};--sw-color-${role}-content:${contentFor(c)};`;
  }
  v += `--sw-color-base-100:${read('base-100')};--sw-color-base-content:${read('base-content')};`;
  return v;
}

interface ParallaxBuilderProps {
  onClose: () => void;
}

const num = (v: string, d: number): number => {
  const n = parseFloat(v);
  return Number.isNaN(n) ? d : n;
};

/**
 * The Library "Parallax builder" — compose a scroll-linked element (translate speed + axis, plus optional
 * opacity / scale / blur channels), preview it live in a sandboxed, SCROLLABLE iframe rendered with the
 * EXACT platform runtime (`api.parallaxRuntime`), and copy the resulting `data-sw-parallax*` markup.
 * Read-only (copy-to-clipboard), like the other Library tools.
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
  const [rt, setRt] = useState<{ css: string; js: string } | null>(null);
  const toast = useToast();
  const [, copy] = useCopy(() => toast.show('Parallax markup copied — paste it onto an element in your page'));

  useEffect(() => {
    let on = true;
    api.parallaxRuntime().then((r) => on && setRt(r)).catch(() => {});
    return () => {
      on = false;
    };
  }, []);

  const brandVars = useMemo(() => brandVarsFromDom(), []);

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

  // A tall, scrollable preview: the runtime drives the sample as the iframe scrolls (the real engine,
  // so it bails under YOUR reduced-motion setting — matching a published page). sandbox: allow-scripts.
  const srcDoc = rt
    ? `<!doctype html><html><head><meta charset="utf-8"><style>:root{${brandVars}}` +
      `html{scroll-behavior:auto}body{margin:0;font-family:system-ui,sans-serif;background:var(--sw-color-base-100,#fff)}` +
      `.pad{height:120vh;display:grid;place-items:center;color:var(--sw-color-base-content,#1a1a23);opacity:.45;font-size:13px}` +
      `.sample{display:grid;place-items:center;min-height:120px;padding:2rem;border-radius:18px;font-weight:700;` +
      `color:var(--sw-color-primary-content,#fff);background:linear-gradient(135deg,var(--sw-color-primary,#4f46e5),var(--sw-color-secondary,#0ea5e9));` +
      `box-shadow:0 18px 50px rgba(0,0,0,.2);margin:0 1.5rem}` +
      `${rt.css}</style></head><body>` +
      `<div class="pad">↓ scroll ↓</div><div class="sample" ${attrs}>Scroll me</div><div class="pad">↑ scroll ↑</div>` +
      `<script>${rt.js}</script></body></html>`
    : '';

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
      <div className="grid gap-6 md:grid-cols-[minmax(0,320px)_1fr]">
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
          <iframe title="Parallax preview" srcDoc={srcDoc} className="block h-[380px] w-full rounded-xl border border-white/10 bg-white" sandbox="allow-scripts" />
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
