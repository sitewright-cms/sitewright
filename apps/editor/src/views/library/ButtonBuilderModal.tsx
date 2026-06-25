import { useEffect, useMemo, useState } from 'react';
import {
  BUTTON_EFFECTS,
  BUTTON_EFFECT_LABELS,
  BUTTON_ACCENTS,
  BUTTON_SHAPES,
  BUTTON_SHAPE_LABELS,
  type ButtonEffect,
  type ButtonAccent,
  type ButtonShape,
} from '@sitewright/schema';
import { BUTTON_EFFECTS_JS } from '@sitewright/blocks';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';
import { useCopy } from '../ui/useCopy';
import { api } from '../../api';
import { glassInput, fieldLabel, ghostButton, gradientSurface } from '../../theme';

// A small inline icon for the Lab effect buttons so icon-bearing effects (icon-spin) showcase, and the
// previews read like real buttons. (Builder previews stay icon-free to match the copied markup.)
const LAB_ICON =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>';

const EFFECTS_SORTED = [...BUTTON_EFFECTS].sort((a, b) => BUTTON_EFFECT_LABELS[a].localeCompare(BUTTON_EFFECT_LABELS[b]));

// daisyUI face variants (the FACE axis is a daisyUI class, not a schema enum).
const FACES: ReadonlyArray<readonly [string, string]> = [
  ['btn-primary', 'Primary'],
  ['btn-secondary', 'Secondary'],
  ['btn-accent', 'Accent'],
  ['btn-neutral', 'Neutral'],
  ['btn-ghost', 'Ghost (transparent)'],
  ['btn-outline btn-primary', 'Outline'],
  ['btn-soft btn-primary', 'Soft'],
];

// The platform's contentColorFor crossover (WCAG luminance, 0.179 → near-black / white).
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

// Best-effort project brand vars for the preview iframe — read the live `--sw-color-*` the editor
// applies for this project (falls back to the compiled CSS's default palette when absent).
function brandVarsFromDom(): string {
  const root = getComputedStyle(document.documentElement);
  const DEFAULTS: Record<string, string> = {
    primary: '#4f46e5',
    secondary: '#0ea5e9',
    accent: '#f59e0b',
    neutral: '#171627',
    'base-100': '#ffffff',
    'base-content': '#1a1a23',
  };
  // only trust a FULLY-matched hex / rgb(a) value (defence-in-depth before it's interpolated into the
  // iframe's <style>: the closing-anchored regexes admit no `;`/`<`/`}` break-out chars); else the default.
  const read = (role: string): string => {
    const raw = root.getPropertyValue(`--sw-color-${role}`).trim();
    return /^#[0-9a-fA-F]{3,8}$/.test(raw) || /^rgba?\([0-9\s,./%]+\)$/i.test(raw) ? raw : DEFAULTS[role]!;
  };
  let v = '';
  for (const role of ['primary', 'secondary', 'accent', 'neutral'] as const) {
    const c = read(role);
    v += `--sw-color-${role}:${c};--sw-color-${role}-content:${contentFor(c)};`;
  }
  v += `--sw-color-base-100:${read('base-100')};--sw-color-base-200:${read('base-100')};--sw-color-base-content:${read('base-content')};`;
  return v;
}

// escape the user's label so it's a literal text node in both the preview iframe and the copied HTML.
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const PAGE_CSS =
  'body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:var(--sw-color-base-100,#fff);color:var(--sw-color-base-content,#1a1a23)}';

interface ButtonBuilderModalProps {
  onClose: () => void;
}

/**
 * The Library "Button builder" — compose a single button (face + effect + accent + shape + label),
 * preview it live in a sandboxed iframe rendered with the EXACT platform-compiled button CSS
 * (`api.buttonPreviewCss`) themed by the project's brand, and copy the resulting `<button class="…">`.
 * The "Lab" tab is a gallery of every effect / shape / accent. Read-only (copy-to-clipboard), like the
 * other Library tools.
 */
export function ButtonBuilderModal({ onClose }: ButtonBuilderModalProps) {
  const [mode, setMode] = useState<'builder' | 'lab'>('builder');
  const [face, setFace] = useState('btn-primary');
  const [effect, setEffect] = useState<'none' | ButtonEffect>('none');
  const [accent, setAccent] = useState<'secondary' | ButtonAccent>('secondary');
  const [shape, setShape] = useState<'rounded' | ButtonShape>('rounded');
  const [label, setLabel] = useState('Get started');
  const [css, setCss] = useState<string | null>(null);
  const toast = useToast();
  const [copiedId, copy] = useCopy(() => toast.show('Button HTML copied — paste it into your page'));

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

  const brandVars = useMemo(() => brandVarsFromDom(), []);

  // omit the baseline defaults (secondary accent / rounded shape) — the .btn baseline already covers them.
  const axisClasses = [
    effect !== 'none' ? `sw-btn-fx-${effect}` : '',
    accent !== 'secondary' ? `sw-btn-accent-${accent}` : '',
    shape !== 'rounded' ? `sw-btn-shape-${shape}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const fullClass = ['btn', face, axisClasses].filter(Boolean).join(' ');
  const code = `<button class="${fullClass}">${escapeHtml(label.trim()) || 'Button'}</button>`;

  // The runtime (ripple + magnetic + spotlight) is injected so the JS-backed effects animate in the
  // preview exactly as on a published page (the iframe is sandboxed: allow-scripts only).
  const frame = (bodyInner: string): string =>
    css
      ? `<!doctype html><html><head><meta charset="utf-8"><style>:root{${brandVars}}\n${css}\n${PAGE_CSS}</style></head><body>${bodyInner}<script>${BUTTON_EFFECTS_JS}</script></body></html>`
      : '';

  const builderBody =
    `<div style="min-height:${180}px;display:flex;align-items:center;justify-content:center;gap:18px;flex-wrap:wrap;padding:32px">` +
    `${code}</div>`;

  const labBody = useMemo(() => {
    const sec = (title: string, cells: string) =>
      `<h3 style="margin:22px 16px 10px;font-size:13px;font-weight:700;color:var(--sw-color-base-content);opacity:.7">${title}</h3>` +
      `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;padding:0 16px">${cells}</div>`;
    const cell = (btn: string, name: string) =>
      `<figure style="margin:0;display:flex;flex-direction:column;align-items:center;gap:8px;padding:16px;border:1px solid color-mix(in oklab,var(--sw-color-base-content) 12%,transparent);border-radius:12px">${btn}<figcaption style="font-size:11px;font-family:ui-monospace,monospace;opacity:.6">${name}</figcaption></figure>`;
    const effects = EFFECTS_SORTED.map((e) => cell(`<button class="btn btn-primary sw-btn-fx-${e}">${LAB_ICON}Get started</button>`, e)).join('');
    const shapes = BUTTON_SHAPES.map((s) =>
      cell(`<button class="btn btn-primary sw-btn-fx-lift sw-btn-shape-${s}">${s === 'square' || s === 'circle' ? '★' : 'Shape'}</button>`, s),
    ).join('');
    const accents = BUTTON_ACCENTS.map((a) =>
      cell(`<button class="btn btn-primary sw-btn-fx-fill-slide sw-btn-accent-${a}">Accent</button>`, a),
    ).join('');
    return (
      `<div style="padding-bottom:24px">` +
      sec(`Effects (${BUTTON_EFFECTS.length})`, effects) +
      sec('Shapes', shapes) +
      sec('Hover accents', accents) +
      `</div>`
    );
  }, []);

  // Same segmented control as the page editor's Code Editor / Content Editor switch.
  const modeToggle = (
    <div
      role="group"
      aria-label="Builder mode"
      className="flex items-center rounded-xl border border-white/60 bg-white/50 p-0.5 text-xs font-medium shadow-sm backdrop-blur-xl"
    >
      {(['builder', 'lab'] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => setMode(m)}
          className={`waves-effect rounded-lg px-2.5 py-1 transition ${mode === m ? `${gradientSurface} font-bold` : 'text-slate-500 hover:text-slate-800'}`}
        >
          {m === 'builder' ? 'Builder' : 'Lab'}
        </button>
      ))}
    </div>
  );

  return (
    <Modal title="Button builder" size="full" onClose={onClose} headerLeft={modeToggle}>
      {mode === 'builder' ? (
        <div className="flex flex-col gap-4 p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="flex flex-col">
              <span className={fieldLabel}>Label</span>
              <input className={glassInput} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Get started" />
            </label>
            <label className="flex flex-col">
              <span className={fieldLabel}>Face</span>
              <select aria-label="Button face" className={glassInput} value={face} onChange={(e) => setFace(e.target.value)}>
                {FACES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col">
              <span className={fieldLabel}>Effect</span>
              <select aria-label="Button effect" className={glassInput} value={effect} onChange={(e) => setEffect(e.target.value === 'none' ? 'none' : (e.target.value as ButtonEffect))}>
                <option value="none">None (baseline)</option>
                {EFFECTS_SORTED.map((b) => (
                  <option key={b} value={b}>
                    {BUTTON_EFFECT_LABELS[b]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col">
              <span className={fieldLabel}>Hover accent</span>
              <select aria-label="Button hover accent" className={glassInput} value={accent} onChange={(e) => setAccent(e.target.value as ButtonAccent)}>
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
              <select aria-label="Button shape" className={glassInput} value={shape} onChange={(e) => setShape(e.target.value as ButtonShape)}>
                {BUTTON_SHAPES.map((s) => (
                  <option key={s} value={s}>
                    {BUTTON_SHAPE_LABELS[s]}
                    {s === 'rounded' ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="overflow-hidden rounded-xl border border-white/10 bg-black/20">
            {css ? (
              <iframe title="Button preview" srcDoc={frame(builderBody)} className="block h-[220px] w-full border-0" sandbox="allow-scripts" />
            ) : (
              <div className="flex h-[220px] items-center justify-center text-sm text-white/40">Loading preview…</div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <pre className="flex-1 overflow-x-auto rounded-lg bg-black/30 px-3 py-2 font-mono text-xs text-white/80">{code}</pre>
            <button type="button" className={`${ghostButton} shrink-0 whitespace-nowrap`} onClick={() => copy(code, 'btn-builder')}>
              {copiedId === 'btn-builder' ? 'Copied ✓' : 'Copy HTML'}
            </button>
          </div>
          <p className="text-xs text-white/50">
            Hover the preview to see the effect. Paste the HTML into a page; the button inherits your site’s
            CI colours. (Secondary accent + rounded shape are the baseline defaults, so they’re omitted from the class list.)
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 p-5">
          <p className="text-xs text-white/50">Every button effect, shape and hover-accent, live with your brand. Switch to the Builder to compose &amp; copy one.</p>
          <div className="overflow-hidden rounded-xl border border-white/10 bg-black/20">
            {css ? (
              <iframe title="Button lab" srcDoc={frame(labBody)} className="block h-[62vh] w-full border-0" sandbox="allow-scripts" />
            ) : (
              <div className="flex h-[62vh] items-center justify-center text-sm text-white/40">Loading…</div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
