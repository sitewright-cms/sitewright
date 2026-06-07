import { useEffect, useState } from 'react';
import type { FontSlotForm } from './model';
import type { SelfHostedFont } from '../../api';
import { fieldLabel, glassInput, ghostButton } from '../../theme';
import { GoogleFontsPicker } from './GoogleFontsPicker';

/** Generic system families a slot can pick (no fetching needed; previews via the CSS generic). */
const SYSTEM_FAMILIES: Array<{ value: string; label: string }> = [
  { value: 'sans-serif', label: 'Sans-serif' },
  { value: 'serif', label: 'Serif' },
  { value: 'monospace', label: 'Monospace' },
];

const WEIGHTS: Array<{ value: number; label: string }> = [
  { value: 100, label: '100 · Thin' },
  { value: 200, label: '200 · Extra Light' },
  { value: 300, label: '300 · Light' },
  { value: 400, label: '400 · Regular' },
  { value: 500, label: '500 · Medium' },
  { value: 600, label: '600 · Semi Bold' },
  { value: 700, label: '700 · Bold' },
  { value: 800, label: '800 · Extra Bold' },
  { value: 900, label: '900 · Black' },
];

const selectClass = `${glassInput} cursor-pointer`;

/**
 * Editor for one typography slot (heading or body): a family picker + weight selector with a
 * live sample. In PR1 only system families are offered; PR2 adds the "Browse Google Fonts"
 * picker (which sets `source: 'google'` + a `fontId`).
 */
export function FontSlotEditor({
  label,
  slot,
  onChange,
  projectId,
  onAddFont,
}: {
  label: string;
  slot: FontSlotForm;
  onChange: (slot: FontSlotForm) => void;
  /** Project id for the Google-Fonts download endpoint. */
  projectId: string;
  /** Registers a downloaded self-hosted font on the form (added to `typography.fonts`). */
  onAddFont: (font: SelfHostedFont) => void;
}) {
  const [picking, setPicking] = useState(false);

  // A selected google font is self-hosted at /fonts/<id>/<weight>.woff2 (same-origin in the
  // editor) — inject its @font-face so the card preview below renders in the actual font.
  useEffect(() => {
    if (slot.source !== 'google' || !slot.fontId) return;
    const style = document.createElement('style');
    style.textContent = `@font-face{font-family:"${slot.family}";font-weight:${slot.weight};font-display:swap;src:url(/fonts/${slot.fontId}/${slot.weight}.woff2) format("woff2")}`;
    document.head.appendChild(style);
    return () => style.remove();
  }, [slot.source, slot.fontId, slot.family, slot.weight]);
  // For a google slot the family is the chosen webfont name; for system it's a generic keyword.
  // Either previews correctly via the CSS `font-family` (the generic keyword or the loaded font).
  const previewFamily = slot.source === 'google' ? `'${slot.family}', sans-serif` : slot.family;
  return (
    <div className="rounded-xl border border-white/60 bg-white/50 p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className={fieldLabel} style={{ margin: 0 }}>{label}</span>
        {slot.source === 'google' && (
          <span className="rounded-full bg-indigo-100/80 px-2 py-0.5 text-[10px] font-semibold uppercase text-indigo-700">
            {slot.family}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="sr-only">{label} family</span>
          <select
            aria-label={`${label} family`}
            className={selectClass}
            value={slot.source === 'system' ? slot.family : '__google__'}
            onChange={(e) => {
              // Switching to a system family resets the slot to system (drops any google fontId).
              if (e.target.value !== '__google__') onChange({ source: 'system', family: e.target.value, weight: slot.weight });
            }}
          >
            {SYSTEM_FAMILIES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
            {/* A custom system family set via CLI/MCP (e.g. `cursive`) stays selectable instead of
                being silently overwritten by the first option. */}
            {slot.source === 'system' && !SYSTEM_FAMILIES.some((f) => f.value === slot.family) && (
              <option value={slot.family}>{slot.family} (custom)</option>
            )}
            {slot.source === 'google' && <option value="__google__">{slot.family} (Google)</option>}
          </select>
        </label>
        <label className="block">
          <span className="sr-only">{label} weight</span>
          <select
            aria-label={`${label} weight`}
            className={selectClass}
            value={slot.weight}
            onChange={(e) => onChange({ ...slot, weight: Number(e.target.value) })}
          >
            {WEIGHTS.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <p
          className="min-w-0 flex-1 truncate text-lg text-slate-700"
          style={{ fontFamily: previewFamily, fontWeight: slot.weight }}
          aria-hidden
        >
          The quick brown fox jumps
        </p>
        <button
          type="button"
          aria-label={`Browse Google Fonts for the ${label.toLowerCase()}`}
          className={`${ghostButton} shrink-0 whitespace-nowrap px-2.5 py-1 text-xs`}
          onClick={() => setPicking(true)}
        >
          Browse Google Fonts
        </button>
      </div>
      {picking && (
        <GoogleFontsPicker
          projectId={projectId}
          slotLabel={label.toLowerCase()}
          onClose={() => setPicking(false)}
          onSelected={(font, weight) => {
            onAddFont(font);
            onChange({ source: 'google', family: font.family, weight, fontId: font.id });
          }}
        />
      )}
    </div>
  );
}
