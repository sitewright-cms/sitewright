import { useEffect, useState } from 'react';
import type { FontSlotForm } from './model';
import type { SelfHostedFont } from '../../api';
import { fieldLabel, glassInput, ghostButton } from '../../theme';
import { GoogleFontsPicker } from './GoogleFontsPicker';
import { LocalFontUploader } from './LocalFontUploader';

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
/** `@font-face` `format()` hint per stored container — mirrors the renderer (typography-css). */
const FORMAT_HINT: Record<string, string> = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' };

/**
 * Editor for one typography slot (heading, body, or a custom named slot): a family picker + weight
 * selector with a live sample. The family can be a system generic, a Google webfont (Browse), or a
 * locally-uploaded font (Upload) — the latter two are self-hosted (`source: 'google' | 'local'` + a
 * `fontId`), and the sample renders in the actual face via an injected `@font-face`.
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
  /** Project id for the Google download / local upload endpoints + the preview font URL. */
  projectId: string;
  /** The project's self-hosted font records (used to render the slot's @font-face preview). */
  fonts: SelfHostedFont[];
  /** Registers a downloaded/uploaded self-hosted font on the form (added to `typography.fonts`). */
  onAddFont: (font: SelfHostedFont) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [uploading, setUploading] = useState(false);

  // A self-hosted slot (google/local) renders the sample in its real face — inject the record's
  // @font-face(s), served project-scoped (the preview route resolves both local + google fonts).
  useEffect(() => {
    if ((slot.source !== 'google' && slot.source !== 'local') || !slot.fontId) return;
    const font = fonts.find((f) => f.id === slot.fontId);
    if (!font) return;
    const css = font.files
      .map(
        (f) =>
          `@font-face{font-family:"${font.family}";font-style:${f.style};font-weight:${f.weight};font-display:swap;` +
          `src:url(/projects/${projectId}/fonts/${font.id}/${f.file}) format("${FORMAT_HINT[f.format] ?? 'woff2'}")}`,
      )
      .join('');
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    return () => style.remove();
  }, [slot.source, slot.fontId, fonts, projectId]);

  const isSelfHosted = slot.source === 'google' || slot.source === 'local';
  // For a self-hosted slot the family is the chosen webfont name; for system it's a generic keyword.
  const previewFamily = isSelfHosted ? `'${slot.family}', sans-serif` : slot.family;
  const sourceTag = slot.source === 'google' ? 'Google' : slot.source === 'local' ? 'Upload' : '';
  return (
    <div className="rounded-xl border border-white/60 bg-white/50 p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className={fieldLabel} style={{ margin: 0 }}>{label}</span>
        {isSelfHosted && (
          <span className="rounded-full bg-indigo-100/80 px-2 py-0.5 text-[10px] font-semibold uppercase text-indigo-700">
            {slot.family} · {sourceTag}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="sr-only">{label} family</span>
          <select
            aria-label={`${label} family`}
            className={selectClass}
            value={slot.source === 'system' ? slot.family : slot.source === 'google' ? '__google__' : '__local__'}
            onChange={(e) => {
              // Switching to a system family resets the slot to system (drops any self-hosted fontId).
              if (e.target.value !== '__google__' && e.target.value !== '__local__') {
                onChange({ source: 'system', family: e.target.value, weight: slot.weight });
              }
            }}
          >
            {SYSTEM_FAMILIES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
            {/* A custom system family set via CLI/MCP (e.g. `cursive`) stays selectable. */}
            {slot.source === 'system' && !SYSTEM_FAMILIES.some((f) => f.value === slot.family) && (
              <option value={slot.family}>{slot.family} (custom)</option>
            )}
            {slot.source === 'google' && <option value="__google__">{slot.family} (Google)</option>}
            {slot.source === 'local' && <option value="__local__">{slot.family} (Upload)</option>}
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
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          aria-label={`Browse Google Fonts for the ${label.toLowerCase()}`}
          className={`${ghostButton} whitespace-nowrap px-2.5 py-1 text-xs`}
          onClick={() => setPicking(true)}
        >
          Browse Google Fonts
        </button>
        <button
          type="button"
          aria-label={`Upload a font for the ${label.toLowerCase()}`}
          className={`${ghostButton} whitespace-nowrap px-2.5 py-1 text-xs`}
          onClick={() => setUploading(true)}
        >
          Upload font
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
      {uploading && (
        <LocalFontUploader
          projectId={projectId}
          slotLabel={label.toLowerCase()}
          defaultWeight={slot.weight}
          onClose={() => setUploading(false)}
          onSelected={(font, weight) => {
            onAddFont(font);
            onChange({ source: 'local', family: font.family, weight, fontId: font.id });
          }}
        />
      )}
    </div>
  );
}
