import { useEffect, useMemo, useState } from 'react';
import type { FontSlotForm } from './model';
import type { MediaAsset } from '../../api';
import { fieldLabel, glassInput, ghostButton } from '../../theme';
import { FontPicker } from './FontPicker';

/** Generic system families a slot can pick (no asset needed; previews via the CSS generic). */
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
const FORMAT_HINT: Record<string, string> = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' };

/**
 * Editor for one typography slot (heading, body, or a custom named slot): a family picker + weight
 * selector with a live sample. The family is either a system generic or a self-hosted font from the
 * library (`source: 'asset'` + an `assetId`) chosen via {@link FontPicker} (Library / Google / Upload).
 */
export function FontSlotEditor({
  label,
  slot,
  onChange,
  projectId,
  fonts,
  onAddFont,
}: {
  label: string;
  slot: FontSlotForm;
  onChange: (slot: FontSlotForm) => void;
  /** Project id for the font picker. */
  projectId: string;
  /** The project's `kind:'font'` library assets (used to render the slot's @font-face preview). */
  fonts: MediaAsset[];
  /** Registers a newly added/downloaded/uploaded font asset (so the preview can resolve it). */
  onAddFont: (asset: MediaAsset) => void;
}) {
  const [picking, setPicking] = useState(false);
  // Memoize so the @font-face effect below depends on a STABLE reference (a bare `fonts.find` returns
  // a new object every render → the effect would re-inject the <style> on every keystroke).
  const asset = useMemo(
    () => (slot.source === 'asset' && slot.assetId ? fonts.find((f) => f.id === slot.assetId) : undefined),
    [slot.source, slot.assetId, fonts],
  );

  // An asset slot renders the sample in its real face — inject the asset's @font-face(s) from the
  // media URL (which the preview route serves inline + the published export self-hosts).
  useEffect(() => {
    if (!asset || asset.kind !== 'font') return;
    // Derive the `/media/<slug>/<assetId>/` base from the asset's own (slug-based) url so we never
    // reconstruct the project segment here; each face just appends its own file name.
    const base = asset.url.slice(0, asset.url.lastIndexOf('/'));
    const css = asset.files
      .map(
        (f) =>
          `@font-face{font-family:"${asset.family}";font-style:${f.style};font-weight:${f.weight};font-display:swap;` +
          `src:url(${base}/${f.file}) format("${FORMAT_HINT[f.format] ?? 'woff2'}")}`,
      )
      .join('');
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    return () => style.remove();
  }, [asset]);

  const isAsset = slot.source === 'asset';
  const previewFamily = isAsset ? `'${slot.family}', sans-serif` : slot.family;
  return (
    <div className="rounded-xl border border-white/60 bg-white/50 p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className={fieldLabel} style={{ margin: 0 }}>{label}</span>
        {isAsset && (
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
            value={isAsset ? '__asset__' : slot.family}
            onChange={(e) => {
              // Switching to a system family resets the slot to system (drops any asset reference).
              if (e.target.value !== '__asset__') onChange({ source: 'system', family: e.target.value, weight: slot.weight });
            }}
          >
            {SYSTEM_FAMILIES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
            {/* A custom system family set via CLI/MCP (e.g. `cursive`) stays selectable. */}
            {!isAsset && !SYSTEM_FAMILIES.some((f) => f.value === slot.family) && (
              <option value={slot.family}>{slot.family} (custom)</option>
            )}
            {isAsset && <option value="__asset__">{slot.family} (library)</option>}
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
      <p
        className="mt-2 truncate text-lg text-slate-700"
        style={{ fontFamily: previewFamily, fontWeight: slot.weight }}
        aria-hidden
      >
        The quick brown fox jumps
      </p>
      <div className="mt-2">
        <button
          type="button"
          aria-label={`Choose a font for the ${label.toLowerCase()}`}
          className={`${ghostButton} whitespace-nowrap px-2.5 py-1 text-xs`}
          onClick={() => setPicking(true)}
        >
          Choose font…
        </button>
      </div>
      {picking && (
        <FontPicker
          projectId={projectId}
          slotLabel={label.toLowerCase()}
          defaultWeight={slot.weight}
          onClose={() => setPicking(false)}
          onPick={(picked, weight) => {
            onAddFont(picked);
            onChange({ source: 'asset', family: picked.kind === 'font' ? picked.family : slot.family, weight, assetId: picked.id });
          }}
        />
      )}
    </div>
  );
}
