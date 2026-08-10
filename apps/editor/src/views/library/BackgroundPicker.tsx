import { useEffect, useMemo, useRef, useState } from 'react';
import { SHADER_BG_PRESETS, SHADER_AUTO_TOKEN } from '@sitewright/blocks';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';
import { useCopy } from '../ui/useCopy';
import { ghostButton, glassPanel } from '../../theme';
import { DEFAULT_BRAND_COLORS, type MandatoryColorToken } from '@sitewright/schema';
import { api } from '../../api';
import { PLATFORM_BG_EVENT } from '../PlatformBackground';
import { shaderRenderer, paletteFromSlots, editorIsDark, type ShaderPalette } from '../../lib/shader-engine';
import { useCiBrandColors } from '../../lib/ci-palette';
import { BrandColorField } from '../ui/ColorPicker';

const DPR = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
// Runtime defaults for the optional knobs — an attribute is emitted only when it DIFFERS from these, so
// the default sample stays minimal (just preset/angle/colors) but a changed knob shows up in the markup.
const DEFAULT_SPEED = 1;
const DEFAULT_INTENSITY = 0.5;

// The CI palette tokens a slot can bind to (theme-aware, follow the project's brand). Kept short — the
// common brand roles. A slot can also be a literal Custom color or the theme-tracking Auto token.
const CI_TOKENS = ['primary', 'secondary', 'accent', 'neutral', 'base-content'] as const;
type SlotMode = (typeof CI_TOKENS)[number] | 'auto' | 'custom';

/** A single `data-colors` slot: a CI token, the `auto` theme token, or a literal Custom color. */
type Slot = { mode: SlotMode; color: string };
/** The `data-colors` value a slot serialises to: its hex when Custom, else the mode name (token/auto). */
const slotToken = (s: Slot): string => (s.mode === 'custom' ? s.color : s.mode === 'auto' ? SHADER_AUTO_TOKEN : s.mode);

/** Ready-made 3-color schemes (brand-1, brand-2, accent/ink), mirroring the showcase palettes. */
const QUICK_PALETTES: { name: string; colors: [string, string, string] }[] = [
  { name: 'Indigo Night', colors: ['#6366f1', '#22d3ee', '#0b1220'] },
  { name: 'Sunset', colors: ['#fb7185', '#fbbf24', '#1e1b4b'] },
  { name: 'Emerald', colors: ['#10b981', '#a3e635', '#052e2b'] },
  { name: 'Orchid', colors: ['#8b5cf6', '#ec4899', '#190a2e'] },
  { name: 'Ice Slate', colors: ['#0ea5e9', '#e2e8f0', '#0f172a'] },
  { name: 'Ember', colors: ['#f97316', '#ef4444', '#fff7ed'] },
];

/** Build the copy-paste `data-sw-component="shader-bg"` markup with a content placeholder. preset/angle/
 *  colors are always present; speed/intensity/interactive appear only when set off their defaults, and an
 *  optional legibility overlay child — so the default sample stays minimal but every knob is authorable. */
function buildMarkup(o: {
  preset: string;
  angle: number;
  colors: string;
  speed: number;
  intensity: number;
  interactive: boolean;
  overlay: boolean;
}): string {
  const attrs = [`data-sw-component="shader-bg"`, `data-preset="${o.preset}"`, `data-angle="${o.angle}"`, `data-colors="${o.colors}"`];
  if (o.speed !== DEFAULT_SPEED) attrs.push(`data-speed="${o.speed}"`);
  if (o.intensity !== DEFAULT_INTENSITY) attrs.push(`data-intensity="${o.intensity}"`);
  if (o.interactive) attrs.push(`data-interactive="true"`);
  const overlay = o.overlay ? `\n  <div data-sw-part="overlay" class="bg-black/30"></div>` : '';
  return `<div ${attrs.join(' ')}>${overlay}
  YOUR HTML CODE HERE
</div>`;
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

/** A labelled range slider — label + current value on top, a FULL-WIDTH slider below. Full-width (no
 *  fixed slider width) keeps the settings panel from establishing a min-content floor that would
 *  overflow the right column horizontally. */
function Knob({ label, value, min, max, step, onChange, fmt }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  fmt?: (v: number) => string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center justify-between text-slate-600 dark:text-slate-300">
        <span>{label}</span>
        <span className="tabular-nums text-xs text-slate-500 dark:text-slate-400">{fmt ? fmt(value) : value}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} className="w-full" />
    </label>
  );
}

/**
 * The Background preset PICKER — a live WebGL gallery over the same 30 presets the site runtime ships
 * (one shared offscreen GL context). Left: a scrollable column of preset cards. Right: the live large
 * preview, a settings panel (speed / intensity / angle / pointer-interactive / legibility overlay + the
 * three color slots, each a CI token, a Custom color, or the theme-tracking AUTO token), and the
 * ready-to-paste `data-sw-component="shader-bg"` markup. Read-only — copy the markup into your page. The
 * sample stays minimal (preset/angle/colors + a content placeholder) and gains data-speed/-intensity/
 * -interactive / the overlay child only when those knobs are changed off their defaults.
 */
export function BackgroundPicker({ onClose, isInstanceAdmin = false }: { onClose: () => void; isInstanceAdmin?: boolean }) {
  const toast = useToast();
  const [copiedId, copy] = useCopy(() => toast.show('Markup copied — paste it into your page'));
  const [savingPlatform, setSavingPlatform] = useState(false);
  const [preset, setPreset] = useState(SHADER_BG_PRESETS[0]!.key);
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [intensity, setIntensity] = useState(DEFAULT_INTENSITY);
  const [angle, setAngle] = useState(0);
  const [interactive, setInteractive] = useState(false);
  const [overlay, setOverlay] = useState(false);
  // The three color slots — default to the project's CI brand tokens (theme-aware); each can be switched
  // to a Custom color or the theme-tracking Auto token.
  const [slots, setSlots] = useState<[Slot, Slot, Slot]>([
    { mode: 'primary', color: '#6366f1' },
    { mode: 'secondary', color: '#22d3ee' },
    { mode: 'neutral', color: '#0b1220' },
  ]);

  const noGl = !shaderRenderer();

  // Track the editor light/dark theme so an `auto` slot re-resolves live when the user flips it.
  const [isDark, setIsDark] = useState(editorIsDark());
  useEffect(() => {
    const mo = new MutationObserver(() => setIsDark(editorIsDark()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);

  const tokens = useMemo(() => slots.map(slotToken) as [string, string, string], [slots]);
  // ★ The OPEN PROJECT's brand palette, so the preview shows the colours this site will actually use.
  // `null` (no project open) falls through to the platform defaults inside the resolver — which is the
  // only case where showing the platform's own indigo/sky is the right answer.
  const brand = useCiBrandColors();
  const palette = useMemo(() => paletteFromSlots(tokens, isDark, brand ?? undefined), [tokens, isDark, brand]);
  const markup = buildMarkup({ preset, angle, colors: tokens.join(','), speed, intensity, interactive, overlay });

  function setSlot(i: number, patch: Partial<Slot>) {
    setSlots((prev) =>
      prev.map((s, idx) => {
        if (idx !== i) return s;
        const next = { ...s, ...patch };
        // Switching TO custom from a CI token seeds the swatch with that token's CURRENT colour, so
        // the picker doesn't jump to a stale/unrelated hue — the project's own where there is one,
        // which is the value the author just saw in the preview.
        if (patch.mode === 'custom' && s.mode !== 'custom') {
          next.color = brand?.[s.mode] ?? DEFAULT_BRAND_COLORS[s.mode as MandatoryColorToken] ?? s.color;
        }
        return next;
      }) as [Slot, Slot, Slot],
    );
  }
  function applyPalette(colors: [string, string, string]) {
    setSlots(colors.map((c) => ({ mode: 'custom' as const, color: c })) as [Slot, Slot, Slot]);
  }

  // Admin-only: set/clear the CURRENT config as the platform-wide background (behind the whole editor +
  // login). Persisted as an instance setting; the live PlatformBackground canvas refetches on the event.
  async function setPlatform(value: { preset: string; angle: number; colors: [string, string, string] } | null) {
    if (savingPlatform) return;
    setSavingPlatform(true);
    try {
      await api.putInstanceSettings({ platformBackground: value });
      window.dispatchEvent(new Event(PLATFORM_BG_EVENT));
      toast.show(value ? 'Set as the platform background' : 'Platform background cleared');
    } catch {
      toast.show('Could not update the platform background');
    } finally {
      setSavingPlatform(false);
    }
  }

  // Live large preview: one RAF loop blitting the selected preset (animated) from the shared renderer,
  // honouring the current speed / intensity / angle and — when Pointer-interactive is on — the eased
  // cursor position.
  const bigRef = useRef<HTMLCanvasElement>(null);
  const mouse = useRef<[number, number]>([0, 0]);
  const pointer = useRef<[number, number] | null>(null);
  // The knob/palette values the RAF loop reads each frame. Kept in a live ref (updated every render) so
  // dragging a slider updates the animation WITHOUT tearing the loop down and restarting it — restarting
  // would reset the time base (`time`/`last`) and make the preview stutter mid-drag. Only a preset change
  // restarts the loop (a genuinely different shader deserves a fresh phase).
  const live = useRef({ speed, intensity, angle, interactive, palette });
  live.current = { speed, intensity, angle, interactive, palette };
  useEffect(() => {
    const cv = bigRef.current;
    const r = shaderRenderer();
    if (!cv || !r) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    let time = 0.8;
    const frame = (now: number) => {
      const { speed, intensity, angle, interactive, palette } = live.current;
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
      if (r.draw(preset, w, h, { time, mouse: mouse.current, intensity, angle: (angle * Math.PI) / 180, interact: interactive ? 1 : 0, ...palette })) {
        ctx.drawImage(r.canvas, 0, 0, w, h);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [preset]);

  const selectedName = SHADER_BG_PRESETS.find((p) => p.key === preset)?.name;

  return (
    <Modal
      title="Animated backgrounds"
      size="screen"
      onClose={onClose}
      headerExtra={
        isInstanceAdmin ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={savingPlatform}
              onClick={() => void setPlatform({ preset, angle, colors: tokens })}
              title="Use this background platform-wide — behind the whole editor and the login screen (admins only)"
              className={`${ghostButton} px-3 py-1.5 text-xs font-semibold disabled:opacity-50`}
            >
              Use as platform background
            </button>
            <button
              type="button"
              disabled={savingPlatform}
              onClick={() => void setPlatform(null)}
              title="Remove the platform-wide background"
              className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 transition hover:border-slate-300 dark:hover:border-slate-600 disabled:opacity-50"
            >
              Clear platform background
            </button>
          </div>
        ) : undefined
      }
    >
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
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
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
            {/* knobs — speed / intensity / angle + interactivity / overlay */}
            <div className="flex min-w-0 flex-col gap-2.5">
              <Knob label="Speed" value={speed} min={0} max={4} step={0.1} onChange={setSpeed} fmt={(v) => `${v}×`} />
              <Knob label="Intensity" value={intensity} min={0} max={1} step={0.05} onChange={setIntensity} />
              <Knob label="Angle" value={angle} min={-360} max={360} step={1} onChange={setAngle} fmt={(v) => `${v}°`} />
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={interactive} onChange={(e) => setInteractive(e.target.checked)} />
                <span className="text-slate-600 dark:text-slate-300">Pointer-interactive (morphs on hover)</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} />
                <span className="text-slate-600 dark:text-slate-300" title="A scrim above the background, below your text, for legibility.">Add text-legibility overlay</span>
              </label>
            </div>

            {/* colors — three slots, each a CI brand token, a Custom color, or the theme-tracking Auto */}
            <div className="flex min-w-0 flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Colors</span>
              <div className="flex flex-wrap gap-1.5" title="Quick palettes set all three to custom colors">
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
              <div className="flex flex-col gap-1.5">
                {(['Color 1', 'Color 2', 'Color 3'] as const).map((label, i) => (
                  <div key={label} className="flex items-center gap-2">
                    <span className="w-12 shrink-0 text-[11px] text-slate-500 dark:text-slate-400">{label}</span>
                    <select
                      value={slots[i]!.mode}
                      aria-label={label}
                      onChange={(e) => setSlot(i, { mode: e.target.value as SlotMode })}
                      className="min-w-0 flex-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 py-1 text-[11px] text-slate-700 dark:text-slate-200"
                    >
                      <optgroup label="Brand (theme-aware)">
                        {CI_TOKENS.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </optgroup>
                      <option value="auto">auto — track theme (light/dark)</option>
                      <option value="custom">custom color…</option>
                    </select>
                    {slots[i]!.mode === 'custom' && (
                      // The platform picker, not the browser's: alpha, four colour spaces, and the
                      // project's own brand one click away — the colours a background is most likely
                      // to want. The native swatch offered none of that and looked different on
                      // every OS.
                      <BrandColorField
                        value={slots[i]!.color}
                        onChange={(color) => setSlot(i, { color })}
                        label={`${label} custom color`}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-stretch gap-2">
            <pre className="max-h-28 min-w-0 flex-1 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">
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
