import { useEffect, useRef, useState } from 'react';
import {
  COLOR_FORMATS,
  type ColorFormat,
  formatColor,
  formatHex,
  hsvToRgb,
  parseColor,
  rgbToHsv,
  SAFE_COLOR,
  type Hsva,
  type Rgba,
} from './color';
import { glassInput } from '../../theme';

// A powerful, dependency-free color picker: a saturation/value square + hue & alpha sliders,
// with four LIVE-converting editable fields (HEX / RGB / HSL / OKLCH). Editing any one updates
// the others instantly. The canonical store is sRGB HEX — 6-digit, or 8-digit `#rrggbbaa` when
// alpha < 1 — so the picker is just an editing surface over a single hex value.

const CHECKER = {
  backgroundImage:
    'linear-gradient(45deg,#cbd5e1 25%,transparent 25%),linear-gradient(-45deg,#cbd5e1 25%,transparent 25%),' +
    'linear-gradient(45deg,transparent 75%,#cbd5e1 75%),linear-gradient(-45deg,transparent 75%,#cbd5e1 75%)',
  backgroundSize: '10px 10px',
  backgroundPosition: '0 0,0 5px,5px -5px,-5px 0',
} as const;

const HUE_GRADIENT =
  'linear-gradient(to right,#f00 0%,#ff0 17%,#0f0 33%,#0ff 50%,#00f 67%,#f0f 83%,#f00 100%)';

/** Seed a fresh Hsva from a stored string, preserving hue when the parse is grayscale. */
function toHsva(value: string, prevHue: number): Hsva {
  const rgba = parseColor(value) ?? { r: 0, g: 0, b: 0, a: 1 };
  const hsva = rgbToHsv(rgba);
  return hsva.s === 0 ? { ...hsva, h: prevHue } : hsva;
}

/** The popover panel. Owns the HSVA working state; emits the canonical hex on every edit. */
export function ColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [hsva, setHsva] = useState<Hsva>(() => toHsva(value, 0));
  // Track our own last emit so an EXTERNAL change to `value` (e.g. the row's text input) re-seeds
  // the picker, while our own emits don't fight the hue/value we're holding.
  const lastEmit = useRef<string>(formatHex(hsvToRgb(hsva)));
  useEffect(() => {
    if (value !== lastEmit.current) {
      setHsva((prev) => toHsva(value, prev.h));
      lastEmit.current = value;
    }
  }, [value]);

  const rgba = hsvToRgb(hsva);

  const emit = (next: Hsva) => {
    setHsva(next);
    const hex = formatHex(hsvToRgb(next));
    lastEmit.current = hex;
    onChange(hex);
  };
  // A typed value arrives as Rgba; preserve the working hue when it's grayscale so the hue
  // slider doesn't jump to 0 the moment a user types an achromatic color.
  const emitRgba = (c: Rgba) => {
    const h = rgbToHsv(c);
    emit(h.s === 0 || h.v === 0 ? { ...h, h: hsva.h } : h);
  };

  const svRef = useRef<HTMLDivElement>(null);
  const onSv = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = svRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const s = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const v = Math.min(1, Math.max(0, 1 - (e.clientY - rect.top) / rect.height));
    emit({ ...hsva, s, v });
  };

  const opaqueHex = `#${[rgba.r, rgba.g, rgba.b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;

  return (
    <div className="flex w-64 flex-col gap-3">
      {/* Saturation × value square (drag to pick). */}
      <div
        ref={svRef}
        role="presentation"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          onSv(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) onSv(e);
        }}
        className="relative h-36 w-full cursor-crosshair touch-none select-none rounded-lg border border-white/60 shadow-inner"
        style={{
          background: `linear-gradient(to top,#000,rgba(0,0,0,0)),linear-gradient(to right,#fff,rgba(255,255,255,0)),hsl(${hsva.h} 100% 50%)`,
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
          style={{ left: `${hsva.s * 100}%`, top: `${(1 - hsva.v) * 100}%`, background: opaqueHex }}
        />
      </div>

      {/* Live preview swatch (over a checkerboard so alpha reads) + hue & alpha sliders. */}
      <div className="flex items-center gap-3">
        <span aria-hidden className="h-9 w-9 shrink-0 rounded-md border border-white/70" style={CHECKER}>
          <span className="block h-full w-full rounded-md" style={{ background: formatHex(rgba) }} />
        </span>
        <div className="flex flex-1 flex-col gap-2">
          <input
            type="range"
            aria-label="Hue"
            min={0}
            max={360}
            value={Math.round(hsva.h)}
            onChange={(e) => emit({ ...hsva, h: Number(e.target.value) })}
            className="h-3 w-full cursor-pointer appearance-none rounded-full"
            style={{ background: HUE_GRADIENT }}
          />
          <span aria-hidden className="block rounded-full" style={CHECKER}>
            <input
              type="range"
              aria-label="Alpha"
              min={0}
              max={1}
              step={0.01}
              value={hsva.a}
              onChange={(e) => emit({ ...hsva, a: Number(e.target.value) })}
              className="block h-3 w-full cursor-pointer appearance-none rounded-full"
              style={{ background: `linear-gradient(to right,rgba(0,0,0,0),${opaqueHex})` }}
            />
          </span>
        </div>
      </div>

      {/* Four editable, live-converting format fields. */}
      <div className="grid grid-cols-2 gap-2">
        {COLOR_FORMATS.map((fmt) => (
          <FormatField key={fmt} fmt={fmt} rgba={rgba} onParsed={emitRgba} />
        ))}
      </div>
    </div>
  );
}

/** One format lens. Shows the live canonical value, but holds the user's exact text while focused. */
function FormatField({ fmt, rgba, onParsed }: { fmt: ColorFormat; rgba: Rgba; onParsed: (c: Rgba) => void }) {
  const canonical = formatColor(rgba, fmt);
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? canonical;
  const invalid = draft !== null && parseColor(draft) === null;
  return (
    <label className="flex flex-col gap-0.5">
      <span className="px-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{fmt}</span>
      <input
        aria-label={fmt.toUpperCase()}
        spellCheck={false}
        maxLength={80}
        value={shown}
        onFocus={() => setDraft(canonical)}
        onChange={(e) => {
          setDraft(e.target.value);
          const parsed = parseColor(e.target.value);
          if (parsed) onParsed(parsed);
        }}
        onBlur={() => setDraft(null)}
        className={`${glassInput} px-2 py-1 font-mono text-[11px] ${invalid ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-300/40' : ''}`}
      />
    </label>
  );
}

/**
 * Shared popover dismissal for the swatch + card triggers: closes on an outside pointerdown or
 * Escape while open. Returns the wrapper ref to put on the popover's root (the "inside" boundary).
 * `setOpen` (a stable useState setter) is intentionally omitted from the deps, so the listeners
 * bind/unbind only as `open` flips.
 */
function useColorPopoverDismiss(open: boolean, setOpen: (v: boolean) => void) {
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return wrapRef;
}

/**
 * A color swatch BUTTON that opens the {@link ColorPicker} in a popover. The swatch shows the
 * current color (over a checkerboard so alpha reads); clicking toggles the picker. Closes on an
 * outside click or Escape. The bound text input lives beside it in the row — this is the visual
 * companion, so direct typing still works.
 */
export function ColorField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useColorPopoverDismiss(open, setOpen);

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        aria-label={`Edit ${label}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="block h-7 w-7 rounded-md border border-white/70 shadow-inner outline-none transition hover:ring-2 hover:ring-indigo-300/50 focus-visible:ring-2 focus-visible:ring-indigo-400/70"
        style={SAFE_COLOR.test(value) ? { ...CHECKER } : { background: 'transparent' }}
      >
        <span aria-hidden className="block h-full w-full rounded-md" style={{ background: SAFE_COLOR.test(value) ? value : 'transparent' }} />
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label={`${label} picker`} className="absolute left-0 top-9 z-50 rounded-xl border border-white/60 bg-white/95 p-3 shadow-2xl backdrop-blur-xl">
          <ColorPicker value={value} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

/**
 * A brand-color CARD: the color's title on top, a full-width clickable preview that opens the
 * {@link ColorPicker} popover, and the current value below — all centered. The picker is the ONLY
 * way to set the color (there is no editable text field), so the stored value is always picker-
 * produced. An empty value reads as "Default" (a cleared mandatory token resets to the platform
 * default on save).
 */
export function ColorCard({ title, value, onChange }: { title: string; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useColorPopoverDismiss(open, setOpen);
  const valid = SAFE_COLOR.test(value);

  return (
    <div ref={wrapRef} className="relative flex flex-col items-center gap-1.5 rounded-xl border border-white/60 bg-white/40 p-2.5 text-center">
      <span className="text-xs font-semibold text-slate-600">{title}</span>
      <button
        type="button"
        aria-label={`Edit ${title}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="block h-12 w-full rounded-lg border border-white/70 shadow-inner outline-none transition hover:ring-2 hover:ring-indigo-300/50 focus-visible:ring-2 focus-visible:ring-indigo-400/70"
        style={valid ? { ...CHECKER } : { background: 'transparent' }}
      >
        <span aria-hidden className="block h-full w-full rounded-lg" style={{ background: valid ? value : 'transparent' }} />
      </button>
      <span className="font-mono text-[11px] text-slate-500">{value || 'Default'}</span>
      {open && (
        <div role="dialog" aria-modal="true" aria-label={`${title} picker`} className="absolute left-0 top-full z-50 mt-1 rounded-xl border border-white/60 bg-white/95 p-3 shadow-2xl backdrop-blur-xl">
          <ColorPicker value={value} onChange={onChange} />
        </div>
      )}
    </div>
  );
}
