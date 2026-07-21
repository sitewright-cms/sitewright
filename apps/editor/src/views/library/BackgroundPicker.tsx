import { useEffect, useMemo, useRef, useState } from 'react';
import { SHADER_BG_PRESETS } from '@sitewright/blocks';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';
import { useCopy } from '../ui/useCopy';
import { ghostButton, glassPanel } from '../../theme';
import { shaderRenderer, ciPalette, paletteFromColors, type ShaderPalette } from '../../lib/shader-engine';

const DPR = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;

/** Ready-made 3-color schemes (brand-1, brand-2, accent/ink), mirroring the showcase palettes. */
const QUICK_PALETTES: { name: string; colors: [string, string, string] }[] = [
  { name: 'Indigo Night', colors: ['#6366f1', '#22d3ee', '#0b1220'] },
  { name: 'Sunset', colors: ['#fb7185', '#fbbf24', '#1e1b4b'] },
  { name: 'Emerald', colors: ['#10b981', '#a3e635', '#052e2b'] },
  { name: 'Orchid', colors: ['#8b5cf6', '#ec4899', '#190a2e'] },
  { name: 'Ice Slate', colors: ['#0ea5e9', '#e2e8f0', '#0f172a'] },
  { name: 'Ember', colors: ['#f97316', '#ef4444', '#fff7ed'] },
];

/** Build the copy-paste `data-sw-component="shader-bg"` markup for the chosen preset + knobs. */
function buildMarkup(o: {
  preset: string;
  speed: number;
  intensity: number;
  angle: number;
  interactive: boolean;
  colors: string | null;
  overlay: boolean;
}): string {
  const attrs = [`data-sw-component="shader-bg"`, `data-preset="${o.preset}"`];
  if (o.speed !== 1) attrs.push(`data-speed="${o.speed}"`);
  if (o.intensity !== 0.5) attrs.push(`data-intensity="${o.intensity}"`);
  if (o.angle !== 0) attrs.push(`data-angle="${o.angle}"`);
  if (o.interactive) attrs.push(`data-interactive="true"`);
  if (o.colors) attrs.push(`data-colors="${o.colors}"`);
  const overlay = o.overlay ? `\n  <div data-sw-part="overlay" class="bg-black/30"></div>` : '';
  return `<section class="relative grid min-h-[60vh] place-items-center" ${attrs.join(' ')}>${overlay}
  <div class="sw-container text-center text-white">
    <h1 class="text-4xl font-bold">Your headline</h1>
    <p class="mt-3 opacity-90">A short supporting line over the animated background.</p>
  </div>
</section>`;
}

/** A single static preset card (full-width banner), blitted from the shared offscreen renderer. */
function PresetCard({ presetKey, palette, intensity, active, onSelect }: {
  presetKey: string;
  palette: ShaderPalette;
  intensity: number;
  active: boolean;
  onSelect: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const r = shaderRenderer();
    if (!cv || !r) return;
    const w = Math.max(2, Math.round((cv.clientWidth || 280) * DPR));
    const h = Math.max(2, Math.round((cv.clientHeight || 84) * DPR));
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    if (r.draw(presetKey, w, h, { time: 0.8, mouse: [0, 0], intensity, angle: 0, interact: 0, ...palette })) {
      ctx.drawImage(r.canvas, 0, 0, w, h);
    }
  }, [presetKey, palette, intensity]);
  const preset = SHADER_BG_PRESETS.find((p) => p.key === presetKey)!;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      title={preset.name}
      className={`group relative shrink-0 overflow-hidden rounded-lg border text-left transition ${
        active ? 'border-indigo-500 ring-2 ring-indigo-400/60' : 'border-slate-200/70 hover:border-indigo-300'
      }`}
    >
      <canvas ref={ref} className="block h-[84px] w-full" />
      <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 py-1 text-[11px] font-medium text-white">
        {preset.name}
      </span>
    </button>
  );
}

/**
 * The Background preset PICKER — a live WebGL gallery over the same 30 presets the site runtime ships
 * (one shared offscreen GL context). Left: a scrollable column of preset cards. Right: the live large
 * preview + settings (speed/intensity/angle/interactivity, a color scheme = CI colors / quick palette /
 * custom, and an optional legibility overlay), and the ready-to-paste `data-sw-component="shader-bg"`
 * markup. Read-only — copy the markup into your page source.
 */
export function BackgroundPicker({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [copiedId, copy] = useCopy(() => toast.show('Markup copied — paste it into your page'));
  const [preset, setPreset] = useState(SHADER_BG_PRESETS[0]!.key);
  const [speed, setSpeed] = useState(1);
  const [intensity, setIntensity] = useState(0.5);
  const [angle, setAngle] = useState(0);
  const [interactive, setInteractive] = useState(false);
  const [overlay, setOverlay] = useState(false);
  // Color scheme: 'ci' = the project CI tokens (default, no data-colors); 'custom' = the 3 colors below
  // (set directly or via a quick palette), emitted as data-colors.
  const [colorMode, setColorMode] = useState<'ci' | 'custom'>('ci');
  const [colA, setColA] = useState('#6366f1');
  const [colB, setColB] = useState('#22d3ee');
  const [colC, setColC] = useState('#0b1220');

  const noGl = !shaderRenderer();

  // Two stable palette refs so toggling/editing one mode never churns the other (no preview stutter
  // or thumbnail re-blit when switching back to CI colors). CI tokens don't change during a session.
  const ciPal = useMemo(() => ciPalette(), []);
  const customPal = useMemo(() => paletteFromColors(colA, colB, colC), [colA, colB, colC]);
  const palette = colorMode === 'custom' ? customPal : ciPal;
  const colorsAttr = colorMode === 'custom' ? `${colA},${colB},${colC}` : null;
  const markup = buildMarkup({ preset, speed, intensity, angle, interactive, colors: colorsAttr, overlay });

  function applyPalette(colors: [string, string, string]) {
    setColA(colors[0]);
    setColB(colors[1]);
    setColC(colors[2]);
    setColorMode('custom');
  }
  function setCustomColor(setter: (v: string) => void, v: string) {
    setter(v);
    setColorMode('custom');
  }

  // Live large preview: one RAF loop blitting the selected preset (animated) from the shared renderer.
  const bigRef = useRef<HTMLCanvasElement>(null);
  const mouse = useRef<[number, number]>([0, 0]);
  const pointer = useRef<[number, number] | null>(null);
  useEffect(() => {
    const cv = bigRef.current;
    const r = shaderRenderer();
    if (!cv || !r) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    let time = 0.8;
    const angleRad = (angle * Math.PI) / 180;
    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000 || 0, 0.05);
      last = now;
      if (speed > 0) time += dt * speed;
      const tgt: [number, number] = interactive && pointer.current ? pointer.current : [0, 0];
      mouse.current[0] += (tgt[0] - mouse.current[0]) * 0.08;
      mouse.current[1] += (tgt[1] - mouse.current[1]) * 0.08;
      const w = Math.max(2, Math.round(cv.clientWidth * DPR));
      const h = Math.max(2, Math.round(cv.clientHeight * DPR));
      if (cv.width !== w || cv.height !== h) {
        cv.width = w;
        cv.height = h;
      }
      if (r.draw(preset, w, h, { time, mouse: mouse.current, intensity, angle: angleRad, interact: interactive ? 1 : 0, ...palette })) {
        ctx.drawImage(r.canvas, 0, 0, w, h);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // `palette` is a useMemo ref that changes only when its inputs do — sufficient as the palette dep.
  }, [preset, speed, intensity, angle, interactive, palette]);

  const selectedName = SHADER_BG_PRESETS.find((p) => p.key === preset)?.name;

  return (
    <Modal title="Animated backgrounds" size="screen" onClose={onClose}>
      <div className="flex h-full min-h-0 gap-4 p-4">
        {/* LEFT — single-column scrollable preset cards */}
        <div className="flex w-[280px] min-h-0 shrink-0 flex-col">
          <p className="mb-2 shrink-0 text-xs text-slate-500 dark:text-slate-400">Pick a background. Themed live by your color scheme →</p>
          {noGl ? (
            <p className="rounded-lg bg-rose-50 dark:bg-rose-500/10 p-3 text-xs text-rose-600 dark:text-rose-400">WebGL unavailable — previews can’t render, but the markup still works on the published site.</p>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto pr-1">
              {SHADER_BG_PRESETS.map((p) => (
                <PresetCard key={p.key} presetKey={p.key} palette={palette} intensity={intensity} active={p.key === preset} onSelect={() => setPreset(p.key)} />
              ))}
            </div>
          )}
        </div>

        {/* RIGHT — large preview + settings + markup */}
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div
            className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-slate-900"
            onPointerMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              if (r.height) pointer.current = [(e.clientX - r.left - r.width * 0.5) / r.height, (r.height * 0.5 - (e.clientY - r.top)) / r.height];
            }}
            onPointerLeave={() => {
              pointer.current = null;
            }}
          >
            <canvas ref={bigRef} className="block h-full w-full" />
            <span className="absolute left-3 bottom-2 text-xs font-semibold text-white drop-shadow">{selectedName}</span>
          </div>

          <div className={`${glassPanel} grid shrink-0 gap-x-6 gap-y-3 rounded-xl p-3 text-sm md:grid-cols-2`}>
            {/* knobs */}
            <div className="flex flex-col gap-2">
              <label className="flex items-center justify-between gap-3">
                <span className="text-slate-600 dark:text-slate-300">Speed</span>
                <input type="range" min={0} max={4} step={0.1} value={speed} onChange={(e) => setSpeed(+e.target.value)} className="w-40" />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span className="text-slate-600 dark:text-slate-300">Intensity</span>
                <input type="range" min={0} max={1} step={0.05} value={intensity} onChange={(e) => setIntensity(+e.target.value)} className="w-40" />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span className="text-slate-600 dark:text-slate-300">Angle</span>
                <input type="range" min={-360} max={360} step={1} value={angle} onChange={(e) => setAngle(+e.target.value)} className="w-40" />
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={interactive} onChange={(e) => setInteractive(e.target.checked)} />
                <span className="text-slate-600 dark:text-slate-300">Pointer-interactive (morphs on hover)</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} />
                <span className="text-slate-600 dark:text-slate-300" title="A scrim above the background, below your text, for legibility.">Add text-legibility overlay</span>
              </label>
            </div>

            {/* color scheme */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Color scheme</span>
                <button
                  type="button"
                  onClick={() => setColorMode('ci')}
                  aria-pressed={colorMode === 'ci'}
                  className={`rounded-md px-2 py-0.5 text-[11px] transition ${colorMode === 'ci' ? 'bg-indigo-100 dark:bg-indigo-500/15 font-semibold text-indigo-700 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10'}`}
                  title="Use the project's corporate-identity colors (no data-colors attribute)"
                >
                  CI colors
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_PALETTES.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    title={p.name}
                    onClick={() => applyPalette(p.colors)}
                    className="h-6 w-9 rounded border border-slate-200 dark:border-slate-700 transition hover:scale-105"
                    style={{ background: `linear-gradient(135deg, ${p.colors[0]}, ${p.colors[1]} 55%, ${p.colors[2]})` }}
                  />
                ))}
              </div>
              <div className="flex items-center gap-3">
                <input type="color" value={colA} onChange={(e) => setCustomColor(setColA, e.target.value)} aria-label="Brand 1" className="h-8 w-9 rounded border border-slate-200 dark:border-slate-700" />
                <input type="color" value={colB} onChange={(e) => setCustomColor(setColB, e.target.value)} aria-label="Brand 2" className="h-8 w-9 rounded border border-slate-200 dark:border-slate-700" />
                <input type="color" value={colC} onChange={(e) => setCustomColor(setColC, e.target.value)} aria-label="Accent / ink" className="h-8 w-9 rounded border border-slate-200 dark:border-slate-700" />
                <span className="text-[11px] text-slate-400 dark:text-slate-500">{colorMode === 'custom' ? 'custom — saved as data-colors' : 'using your CI colors'}</span>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-stretch gap-2">
            <pre className="max-h-28 flex-1 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">
              <code>{markup}</code>
            </pre>
            <button onClick={() => copy(markup, 'shader-bg')} className={`${ghostButton} shrink-0 self-start px-4 py-2 text-sm font-semibold`}>
              {copiedId === 'shader-bg' ? 'Copied!' : 'Copy markup'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
