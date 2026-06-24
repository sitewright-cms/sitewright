import { useEffect, useMemo, useRef, useState } from 'react';
import { SHADER_BG_PRESETS } from '@sitewright/blocks';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';
import { useCopy } from '../ui/useCopy';
import { ghostButton, glassPanel } from '../../theme';
import { shaderRenderer, ciPalette, paletteFromColors, type ShaderPalette } from '../../lib/shader-engine';

const DPR = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;

/** Build the copy-paste `data-sw-component="shader-bg"` markup for the chosen preset + knobs. */
function buildMarkup(o: {
  preset: string;
  speed: number;
  intensity: number;
  angle: number;
  interactive: boolean;
  colors: string | null;
}): string {
  const attrs = [`data-sw-component="shader-bg"`, `data-preset="${o.preset}"`];
  if (o.speed !== 1) attrs.push(`data-speed="${o.speed}"`);
  if (o.intensity !== 0.5) attrs.push(`data-intensity="${o.intensity}"`);
  if (o.angle !== 0) attrs.push(`data-angle="${o.angle}"`);
  if (o.interactive) attrs.push(`data-interactive="true"`);
  if (o.colors) attrs.push(`data-colors="${o.colors}"`);
  return `<section class="relative grid min-h-[60vh] place-items-center" ${attrs.join(' ')}>
  <div data-sw-part="overlay" class="bg-black/30"></div>
  <div class="sw-container text-center text-white">
    <h1 class="text-4xl font-bold">Your headline</h1>
    <p class="mt-3 opacity-90">A short supporting line over the animated background.</p>
  </div>
</section>`;
}

/** A single static preset thumbnail, blitted from the shared offscreen renderer. */
function Thumb({ presetKey, palette, intensity, active, onSelect }: {
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
    const w = Math.max(2, Math.round((cv.clientWidth || 160) * DPR));
    const h = Math.max(2, Math.round((cv.clientHeight || 90) * DPR));
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
      className={`group relative overflow-hidden rounded-lg border transition ${
        active ? 'border-indigo-500 ring-2 ring-indigo-400/60' : 'border-slate-200/70 hover:border-indigo-300'
      }`}
    >
      <canvas ref={ref} className="block aspect-[16/9] w-full" />
      <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 py-1 text-left text-[11px] font-medium text-white">
        {preset.name}
      </span>
    </button>
  );
}

/**
 * The Background preset PICKER: a live WebGL gallery (one shared offscreen GL context) over the same
 * 30 presets the site runtime ships. Pick a preset, tune speed/intensity/angle/interactivity (and,
 * optionally, override the palette), then copy the ready-to-paste `data-sw-component="shader-bg"`
 * markup into your page source. Read-only — it never mutates the project.
 */
export function BackgroundPicker({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [copiedId, copy] = useCopy(() => toast.show('Markup copied — paste it into your page'));
  const [preset, setPreset] = useState(SHADER_BG_PRESETS[0]!.key);
  const [speed, setSpeed] = useState(1);
  const [intensity, setIntensity] = useState(0.5);
  const [angle, setAngle] = useState(0);
  const [interactive, setInteractive] = useState(false);
  const [custom, setCustom] = useState(false);
  const [colA, setColA] = useState('#4f46e5');
  const [colB, setColB] = useState('#0ea5e9');
  const [colC, setColC] = useState('#0b1220');

  const noGl = !shaderRenderer();

  // Active palette: project CI tokens, or the user's literal overrides.
  const palette = useMemo<ShaderPalette>(
    () => (custom ? paletteFromColors(colA, colB, colC) : ciPalette()),
    [custom, colA, colB, colC],
  );
  const colorsAttr = custom ? `${colA},${colB},${colC}` : null;
  const markup = buildMarkup({ preset, speed, intensity, angle, interactive, colors: colorsAttr });

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

  return (
    <Modal title="Animated backgrounds" size="full" onClose={onClose}>
      <div className="flex h-full min-h-0 flex-col gap-3 p-5 md:flex-row">
        {/* left: scrollable preset gallery */}
        <div className="flex min-h-0 flex-1 flex-col">
          <p className="mb-2 text-sm text-slate-500">
            A GPU animated background themed by your CI colors. Pick a preset, tune it, then copy the markup into a section.
          </p>
          {noGl ? (
            <p className="rounded-lg bg-rose-50 p-4 text-sm text-rose-600">
              WebGL isn’t available in this browser, so previews can’t render — the markup still works on the published site.
            </p>
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-auto pr-1 sm:grid-cols-3">
              {SHADER_BG_PRESETS.map((p) => (
                <Thumb
                  key={p.key}
                  presetKey={p.key}
                  palette={palette}
                  intensity={intensity}
                  active={p.key === preset}
                  onSelect={() => setPreset(p.key)}
                />
              ))}
            </div>
          )}
        </div>

        {/* right: large preview + controls + markup */}
        <div className="flex w-full shrink-0 flex-col gap-3 md:w-[22rem]">
          <div
            className="relative overflow-hidden rounded-xl border border-slate-200"
            onPointerMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              if (r.height) pointer.current = [(e.clientX - r.left - r.width * 0.5) / r.height, (r.height * 0.5 - (e.clientY - r.top)) / r.height];
            }}
            onPointerLeave={() => {
              pointer.current = null;
            }}
          >
            <canvas ref={bigRef} className="block aspect-[16/9] w-full bg-slate-900" />
            <span className="absolute left-3 bottom-2 text-xs font-semibold text-white drop-shadow">
              {SHADER_BG_PRESETS.find((p) => p.key === preset)?.name}
            </span>
          </div>

          <div className={`${glassPanel} flex flex-col gap-3 rounded-xl p-3 text-sm`}>
            <label className="flex items-center justify-between gap-3">
              <span className="text-slate-600">Speed</span>
              <input type="range" min={0} max={4} step={0.1} value={speed} onChange={(e) => setSpeed(+e.target.value)} className="w-44" />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span className="text-slate-600">Intensity</span>
              <input type="range" min={0} max={1} step={0.05} value={intensity} onChange={(e) => setIntensity(+e.target.value)} className="w-44" />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span className="text-slate-600">Angle</span>
              <input type="range" min={-360} max={360} step={1} value={angle} onChange={(e) => setAngle(+e.target.value)} className="w-44" />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={interactive} onChange={(e) => setInteractive(e.target.checked)} />
              <span className="text-slate-600">Pointer-interactive (morphs on hover)</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={custom} onChange={(e) => setCustom(e.target.checked)} />
              <span className="text-slate-600">Override colors</span>
            </label>
            {custom && (
              <div className="flex items-center gap-3">
                <input type="color" value={colA} onChange={(e) => setColA(e.target.value)} aria-label="Color 1" className="h-8 w-10 rounded border border-slate-200" />
                <input type="color" value={colB} onChange={(e) => setColB(e.target.value)} aria-label="Color 2" className="h-8 w-10 rounded border border-slate-200" />
                <input type="color" value={colC} onChange={(e) => setColC(e.target.value)} aria-label="Color 3" className="h-8 w-10 rounded border border-slate-200" />
                <span className="text-[11px] text-slate-400">else uses your CI colors</span>
              </div>
            )}
          </div>

          <pre className="max-h-40 overflow-auto rounded-lg border border-slate-200 bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">
            <code>{markup}</code>
          </pre>
          <button onClick={() => copy(markup, 'shader-bg')} className={`${ghostButton} w-full py-2 text-sm font-semibold`}>
            {copiedId === 'shader-bg' ? 'Copied — paste into your page' : 'Copy markup'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
