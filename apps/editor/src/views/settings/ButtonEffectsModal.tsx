import { useEffect, useMemo, useState } from 'react';
import {
  BUTTON_EFFECTS,
  BUTTON_EFFECT_LABELS,
  BUTTON_EFFECT_KIND,
  buttonEffectFacePairing,
  BUTTON_ACCENTS,
  BUTTON_DEFAULT_SHAPES,
  BUTTON_SHAPE_LABELS,
  DEFAULT_BRAND_COLORS,
  type ButtonEffect,
  type ButtonEffectKind,
  type ButtonAccent,
  type ButtonDefaultShape,
} from '@sitewright/schema';
import { BUTTON_EFFECTS_JS } from '@sitewright/blocks';
import { Modal } from '../ui/Modal';
import { api } from '../../api';
import { glassInput, fieldLabel } from '../../theme';
import type { SettingsForm } from './model';

const EFFECTS_SORTED = [...BUTTON_EFFECTS].sort((a, b) => BUTTON_EFFECT_LABELS[a].localeCompare(BUTTON_EFFECT_LABELS[b]));

// FACE (the daisyUI variant) and EFFECT are orthogonal axes — group the picker by kind (BUTTON_EFFECT_KIND)
// so the composability is obvious. The preview below already shows the effect on three faces.
const KIND_LABEL: Record<ButtonEffectKind, string> = {
  motion: 'Motion — layers on any face',
  reveal: 'Reveal — best on Outline / Ghost',
  face: 'Face — the effect defines the look',
};
const KIND_ORDER: readonly ButtonEffectKind[] = ['motion', 'reveal', 'face'];
const EFFECTS_BY_KIND = KIND_ORDER.map((kind) => ({
  kind,
  label: KIND_LABEL[kind],
  effects: EFFECTS_SORTED.filter((e) => BUTTON_EFFECT_KIND[e] === kind),
}));
const FACE_HINT: Record<'any' | 'hollow' | 'defines', string> = {
  any: 'Motion effect — it layers on top, so every button keeps whatever face (btn-primary, btn-ghost, …) you give it.',
  hollow: 'Reveal effect — the accent animates in on hover; the button rests as its face. Shines on btn-outline / btn-ghost, composes over solid faces too.',
  defines: 'Face effect — it repaints the button’s look; the daisyUI variant supplies the base colour.',
};

// The platform's contentColorFor crossover (WCAG relative luminance, 0.179 → near-black / white).
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

export interface ButtonEffectsValue {
  buttonEffect: 'none' | ButtonEffect;
  buttonAccent: '' | ButtonAccent;
  buttonShape: '' | ButtonDefaultShape;
}

interface ButtonEffectsModalProps {
  form: SettingsForm;
  onApply: (v: ButtonEffectsValue) => void;
  onClose: () => void;
}

/**
 * Site-wide button DEFAULTS picker with a live preview. The preview is a sandboxed iframe loading the
 * platform-compiled button CSS (`api.buttonPreviewCss`) plus the project's brand colours (injected as
 * `--sw-color-*` from `form.colors`), so the sample buttons render EXACTLY as the published site — no
 * engine render, no drift. A bare `.btn` inherits these defaults; a per-button class overrides them.
 */
export function ButtonEffectsModal({ form, onApply, onClose }: ButtonEffectsModalProps) {
  const [effect, setEffect] = useState<'none' | ButtonEffect>(form.buttonEffect);
  const [accent, setAccent] = useState<'' | ButtonAccent>(form.buttonAccent);
  const [shape, setShape] = useState<'' | ButtonDefaultShape>(form.buttonShape);
  const [css, setCss] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    api
      .buttonPreviewCss()
      .then((r) => on && setCss(r.css))
      .catch(() => {});
    return () => {
      on = false;
    };
  }, []);

  const colorOf = (key: string): string =>
    form.colors.find((p) => p.key === key)?.value || (DEFAULT_BRAND_COLORS as Record<string, string>)[key] || '#4f46e5';

  const brandVars = useMemo(() => {
    let v = '';
    for (const role of ['primary', 'secondary', 'accent', 'neutral'] as const) {
      const c = colorOf(role);
      v += `--sw-color-${role}:${c};--sw-color-${role}-content:${contentFor(c)};`;
    }
    v += `--sw-color-base-100:${colorOf('base-100')};--sw-color-base-200:${colorOf('base-100')};--sw-color-base-content:${colorOf('base-content')};`;
    return v;
  }, [form.colors]);

  const axisClasses = [
    effect && effect !== 'none' ? `sw-btn-fx-${effect}` : '',
    accent ? `sw-btn-accent-${accent}` : '',
    shape ? `sw-btn-shape-${shape}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const srcDoc = css
    ? `<!doctype html><html><head><meta charset="utf-8"><style>:root{${brandVars}}\n${css}\n` +
      `body{margin:0;display:flex;flex-wrap:wrap;gap:18px;align-items:center;justify-content:center;min-height:148px;padding:28px;` +
      `background:var(--sw-color-base-100,#fff);font-family:system-ui,-apple-system,sans-serif}</style></head><body>` +
      `<button class="btn btn-primary ${axisClasses}">Get started</button>` +
      `<button class="btn btn-ghost ${axisClasses}">Learn more</button>` +
      `<button class="btn btn-outline btn-primary ${axisClasses}">Contact</button>` +
      `<script>${BUTTON_EFFECTS_JS}</script>` +
      `</body></html>`
    : '';

  return (
    <Modal
      title="Button effects"
      size="xl"
      onClose={onClose}
      saveLabel="Apply"
      onSave={() => {
        onApply({ buttonEffect: effect, buttonAccent: accent, buttonShape: shape });
        onClose();
      }}
    >
      <div className="p-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col">
          <span className={fieldLabel}>Effect</span>
          <select
            aria-label="Button effect"
            className={glassInput}
            value={effect || 'none'}
            onChange={(e) => setEffect(e.target.value === 'none' ? 'none' : (e.target.value as ButtonEffect))}
          >
            <option value="none">None (baseline only)</option>
            {EFFECTS_BY_KIND.map((g) => (
              <optgroup key={g.kind} label={g.label}>
                {g.effects.map((b) => (
                  <option key={b} value={b}>
                    {BUTTON_EFFECT_LABELS[b]}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className={fieldLabel}>Hover accent</span>
          <select
            aria-label="Button hover accent"
            className={glassInput}
            value={accent || 'secondary'}
            onChange={(e) => setAccent(e.target.value === 'secondary' ? '' : (e.target.value as ButtonAccent))}
          >
            {BUTTON_ACCENTS.map((a) => (
              <option key={a} value={a}>
                {a[0]!.toUpperCase() + a.slice(1)}
                {a === 'secondary' ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className={fieldLabel}>Shape</span>
          <select
            aria-label="Button shape"
            className={glassInput}
            value={shape || 'rounded'}
            onChange={(e) => setShape(e.target.value === 'rounded' ? '' : (e.target.value as ButtonDefaultShape))}
          >
            {BUTTON_DEFAULT_SHAPES.map((s) => (
              <option key={s} value={s}>
                {BUTTON_SHAPE_LABELS[s]}
                {s === 'rounded' ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-4 overflow-hidden rounded-xl border border-white/10 bg-black/20">
        {css ? (
          <iframe title="Button preview" srcDoc={srcDoc} className="block h-[200px] w-full border-0" sandbox="allow-scripts" />
        ) : (
          <div className="flex h-[200px] items-center justify-center text-sm text-white/40">Loading preview…</div>
        )}
      </div>
      {effect !== 'none' && (
        <p className="mt-2 rounded-lg bg-white/5 px-3 py-2 text-xs text-white/70">
          <span className="font-semibold text-white/90">Face + Effect are independent.</span>{' '}
          {FACE_HINT[buttonEffectFacePairing(effect)]}
        </p>
      )}
      <p className="mt-2 text-xs text-white/50">
        Hover the sample buttons (solid, ghost and outline faces). These are the SITE DEFAULTS — every{' '}
        <code>.btn</code> inherits them; add a per-button class (e.g. <code>sw-btn-fx-lift</code>) to override
        one button. For a fully custom effect, pick “None” and use the Edit-code option.
      </p>
      </div>
    </Modal>
  );
}
