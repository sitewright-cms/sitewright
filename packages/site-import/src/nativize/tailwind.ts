// The responsive Tailwind transform: a captured computed-style map (only non-default props) → keyed
// utility GROUPS, then a mobile-first merge across the 3 breakpoint captures into one class list with
// md:/lg: overrides. Each utility lives under a KEY (its property group) so the merge can override OR
// reset it per breakpoint. Pure — runs server-side, unit-tested without a browser. Ported from the
// matured _clone.mjs spike; the brand palette is injected (not hardcoded) so it works for any project.
import {
  type NativizePalette, arbitrary, colorToken, colorValue, dim, fontSizeClass, hexOf, radiusClass, space, spaceToken,
} from './tokens.js';

/** A node's captured computed styles at one viewport — only props that differ from the browser default. */
export type StyleMap = Readonly<Record<string, string>>;
export interface EmitContext {
  palette: NativizePalette;
}
/** A keyed group map (prop-group → utility class) plus non-responsive inline-style fragments. */
export interface GroupResult {
  g: Record<string, string>;
  st: string[];
}

const FWEIGHT: Readonly<Record<string, string>> = { '700': 'font-bold', '600': 'font-semibold', '500': 'font-medium', '400': 'font-normal', '300': 'font-light' };
const DISPLAY: Readonly<Record<string, string>> = { flex: 'flex', 'inline-flex': 'inline-flex', grid: 'grid', 'inline-grid': 'inline-grid', 'inline-block': 'inline-block', inline: 'inline', none: 'hidden', block: 'block' };
const ALIGN: Readonly<Record<string, string>> = { 'flex-start': 'start', 'flex-end': 'end', center: 'center', stretch: 'stretch', baseline: 'baseline' };
const JUSTIFY: Readonly<Record<string, string>> = { 'flex-start': 'start', 'flex-end': 'end', center: 'center', 'space-between': 'between', 'space-around': 'around', 'space-evenly': 'evenly' };

/**
 * Turn a single viewport's style map into keyed utility groups (`g`) + inline-style fragments (`st`,
 * for non-responsive things like multi-layer shadows / elliptical radius / background images).
 */
export function emitGroups(s: StyleMap, tag: string, pflex: boolean, ctx: EmitContext): GroupResult {
  const { palette } = ctx;
  const tok = (v: string): string | null => colorToken(v, palette);
  const cvar = (v: string): string => colorValue(v, palette);
  const g: Record<string, string> = {};
  const st: string[] = [];

  if (s.color) { const t = tok(s.color); g.color = `text-${t ? t : `[${hexOf(s.color)}]`}`; }
  if (s['background-color']) { const t = tok(s['background-color']); g.bg = `bg-${t ? t : `[${hexOf(s['background-color'])}]`}`; }
  if (s['font-family']) { const ff = s['font-family']; const f = palette.fonts.find(([k]) => ff.includes(k)); if (f) g.fontfam = f[1]; }
  if (s['font-size']) g.fsize = fontSizeClass(s['font-size']);
  if (s['font-weight']) g.fweight = FWEIGHT[s['font-weight']] ?? `font-[${s['font-weight']}]`;
  if (s['font-style'] === 'italic') g.fstyle = 'italic';
  if (s['line-height'] && s['line-height'] !== 'normal') { const lt = spaceToken(s['line-height'], 2.5); g.leading = lt !== null ? `leading-${lt}` : `leading-[${s['line-height']}]`; }
  if (s['letter-spacing'] && s['letter-spacing'] !== 'normal') g.tracking = `tracking-[${s['letter-spacing']}]`;
  if (s['text-align'] && s['text-align'] !== 'start' && s['text-align'] !== 'left') g.talign = `text-${s['text-align']}`;
  if (s['text-transform'] && s['text-transform'] !== 'none') g.ttransform = s['text-transform']; // 'uppercase'/'lowercase'/'capitalize' ARE Tailwind classes
  if (s['text-decoration-line'] && s['text-decoration-line'] !== 'none') g.tdecor = `[text-decoration-line:${s['text-decoration-line']}]`;
  if (s['white-space'] && s['white-space'] !== 'normal') g.whitespace = s['white-space'] === 'nowrap' ? 'whitespace-nowrap' : `[white-space:${s['white-space']}]`;
  if (s.display) g.display = DISPLAY[s.display] ?? `[display:${s.display}]`;
  if (s['flex-direction'] === 'column') g.flexdir = 'flex-col'; else if (s['flex-direction'] && s['flex-direction'] !== 'row') g.flexdir = `[flex-direction:${s['flex-direction']}]`;
  if (s['flex-wrap'] === 'wrap') g.flexwrap = 'flex-wrap';
  if (s['align-items'] && s['align-items'] !== 'normal') g.items = `items-${ALIGN[s['align-items']] ?? s['align-items']}`;
  if (s['justify-content'] && s['justify-content'] !== 'normal') g.justify = `justify-${JUSTIFY[s['justify-content']] ?? s['justify-content']}`;
  // column-gap / row-gap captured SEPARATELY — a 3-col footer with col-gap 32 + row-gap 48 must not
  // collapse to one `gap-12`. Equal → `gap-N`; different → `gap-x-N` + `gap-y-N`.
  {
    const cg = s['column-gap'], rg = s['row-gap'];
    if (cg && cg !== 'normal' && rg && rg !== 'normal') { if (cg === rg) g.gap = space('gap', cg); else { g.gapx = space('gap-x', cg); g.gapy = space('gap-y', rg); } }
    else if (s.gap && s.gap !== 'normal') { const pr = s.gap.split(/\s+/); if (pr.length === 2 && pr[0] !== pr[1]) { g.gapy = space('gap-y', pr[0]!); g.gapx = space('gap-x', pr[1]!); } else g.gap = space('gap', pr[0]!); }
  }
  if (s['grid-template-columns'] && s['grid-template-columns'] !== 'none') {
    // getComputedStyle resolves `1fr 1fr` to px ("768px 384px"), which would pin a fluid grid to fixed
    // tracks that overflow narrow viewports. Re-fluidize: equal px → grid-cols-N; unequal px → proportional
    // fr (keeps the ratio); non-px tracks kept as-is.
    const tr = s['grid-template-columns'].trim().split(/\s+/), px = tr.map(parseFloat);
    const allPx = px.length === tr.length && px.length > 0 && tr.every((t) => t.endsWith('px')) && px.every((n) => !Number.isNaN(n) && n > 0);
    const allEq = allPx && px.every((n) => Math.abs(n - px[0]!) <= Math.max(2, px[0]! * 0.05));
    g.gridcols = allEq ? `grid-cols-${tr.length}` : allPx ? `grid-cols-[${px.map((n) => `minmax(0,${Math.round(n)}fr)`).join('_')}]` : `grid-cols-[${arbitrary(s['grid-template-columns'])}]`;
  }
  if (s.position && s.position !== 'static') g.position = s.position;
  if (s['z-index'] && s['z-index'] !== 'auto') g.zindex = `z-[${s['z-index']}]`;
  for (const pp of ['top', 'right', 'bottom', 'left'] as const) { const v = s[pp]; if (v && v !== 'auto' && v !== '0px') g[pp] = dim(pp, v); } // skip no-op 0 insets

  // width: a centered fixed-width container → responsive `w-full max-w-[W]`; a plain fixed width → pin it
  // BUT cap with max-w-full so it can never overflow a narrow viewport.
  const ml = s['margin-left'], mr = s['margin-right'];
  const centered = !!(ml && mr && ml === mr && parseFloat(ml) > 0);
  if (s.width && s.width !== 'auto') { if (s.width === '100%') g.w = 'w-full'; else if (centered) { g.w = 'w-full'; g.maxw = dim('max-w', s.width); } else { g.w = dim('w', s.width); g.maxw = 'max-w-full'; } }
  // height: pin for <iframe> (video/map) or a clipping (overflow-hidden) viewport; a background BAND keeps
  // a min-h floor; plain content containers size to content (no floor → no empty space when content reflows).
  if (s.height && s.height !== 'auto' && s.height !== '100%') {
    if (tag === 'iframe') g.h = dim('h', s.height);
    else if (tag !== 'img' && s.overflow === 'hidden') g.h = dim('h', s.height);
    else if (tag !== 'img' && s['background-image'] && s['background-image'] !== 'none') g.minh = dim('min-h', s.height);
  }
  if (s['min-height'] && s['min-height'] !== 'auto' && s['min-height'] !== '0px') g.minh = dim('min-h', s['min-height']);
  if (s['max-width'] && s['max-width'] !== 'none') g.maxw = s['max-width'] === '100%' ? 'max-w-full' : dim('max-w', s['max-width']);
  if (tag === 'img') { g.h = 'h-auto'; if (!g.maxw) g.maxw = 'max-w-full'; } // responsive images: keep aspect, never overflow the column

  for (const base of ['margin', 'padding'] as const) {
    const pf = base === 'margin' ? 'm' : 'p';
    const t = s[`${base}-top`], r = s[`${base}-right`], bo = s[`${base}-bottom`], l = s[`${base}-left`], au = pf === 'm';
    const tv = parseFloat(t || '0'), bv = parseFloat(bo || '0'), lv = parseFloat(l || '0'), rv = parseFloat(r || '0');
    // VERTICAL: a flex child centered with `margin-block:auto` resolves to ~equal top/bottom px. Detect it
    // APPROXIMATELY (sub-pixel rounding ≤2px) → restore my-auto so it re-centers as the band grows. Must be
    // a flex child (else equal margins are intentional spacing → keep px).
    if (au && pflex && t && bo && Math.abs(tv - bv) <= 2 && tv > 4) g.my = 'my-auto';
    else if (t && bo && t === bo) g[`${pf}y`] = space(`${pf}y`, t);
    else { if (t) g[`${pf}t`] = space(`${pf}t`, t); if (bo) g[`${pf}b`] = space(`${pf}b`, bo); }
    // HORIZONTAL: equal left/right → mx-auto (centered); a flex child's asymmetric auto → ml-auto/mr-auto.
    if (l && r && Math.abs(lv - rv) <= 2 && (au ? lv > 0 : true)) { g[`${pf}x`] = au ? 'mx-auto' : space(`${pf}x`, l); }
    else {
      if (au && pflex && lv > rv + 24) { g.ml = 'ml-auto'; if (r) g.mr = space('mr', r); }
      else if (au && pflex && rv > lv + 24) { g.mr = 'mr-auto'; if (l) g.ml = space('ml', l); }
      else { if (l) g[`${pf}l`] = space(`${pf}l`, l); if (r) g[`${pf}r`] = space(`${pf}r`, r); }
    }
  }
  for (const sd of ['top', 'right', 'bottom', 'left'] as const) { const w = s[`border-${sd}-width`]; if (w) g[`border${sd}`] = `[border-${sd}:${w}_${s[`border-${sd}-style`] || 'solid'}_${cvar(s[`border-${sd}-color`] || '')}]`; }
  if (s['border-radius']) { if (s['border-radius'].includes('/')) st.push(`border-radius:${s['border-radius']}`); else g.radius = radiusClass(s['border-radius']); }
  if (s['box-shadow'] && s['box-shadow'] !== 'none') st.push(`box-shadow:${s['box-shadow']}`);
  if (s.opacity && s.opacity !== '1') g.opacity = `opacity-[${s.opacity}]`;
  if (s.transform && s.transform !== 'none' && !/matrix3d/.test(s.transform) && !/^matrix\(1,\s*0,\s*0,\s*1,\s*0,\s*0\)$/.test(s.transform)) g.transform = `[transform:${arbitrary(s.transform)}]`;
  if (s.overflow && s.overflow !== 'visible') g.overflow = `overflow-${s.overflow}`;
  if (s['object-fit'] && s['object-fit'] !== 'fill') g.objectfit = `object-${s['object-fit']}`;
  if (s['aspect-ratio'] && s['aspect-ratio'] !== 'auto') g.aspect = `aspect-[${s['aspect-ratio'].replace(/\s*\/\s*/, '/').replace(/\s+/g, '/')}]`;
  if (s['background-image'] && s['background-image'] !== 'none') { const bg = s['background-image'].replace(/"/g, "'"); st.push(`background-image:${bg};background-size:${(s['background-size'] || 'cover').split(',')[0]};background-position:${(s['background-position'] || 'center').split(',')[0]};background-repeat:${(s['background-repeat'] || 'no-repeat').split(',')[0]}`); }
  return { g, st };
}

// To turn a property OFF at a larger breakpoint (set at base, absent later) we emit its default class.
export const RESET: Readonly<Record<string, string>> = {
  w: 'w-auto', h: 'h-auto', minh: 'min-h-0', maxw: 'max-w-none', display: 'block', flexdir: 'flex-row', flexwrap: 'flex-nowrap',
  items: 'items-stretch', justify: 'justify-start', gap: 'gap-0', gapx: 'gap-x-0', gapy: 'gap-y-0', gridcols: 'grid-cols-none', talign: 'text-left', ttransform: 'normal-case',
  tdecor: 'no-underline', whitespace: 'whitespace-normal', position: 'static', zindex: 'z-auto', top: 'top-auto', right: 'right-auto', bottom: 'bottom-auto', left: 'left-auto',
  aspect: 'aspect-auto', overflow: 'overflow-visible', opacity: 'opacity-100',
  mt: 'mt-0', mb: 'mb-0', my: 'my-0', ml: 'ml-0', mr: 'mr-0', mx: 'mx-0', pt: 'pt-0', pb: 'pb-0', py: 'py-0', pl: 'pl-0', pr: 'pr-0', px: 'px-0',
};

/** One viewport's groups + its breakpoint prefix (`""` / `"md:"` / `"lg:"`). */
export interface BreakpointGroups extends GroupResult {
  bp: string;
}

/** Merge per-breakpoint group maps (small→large) into one mobile-first class list with md:/lg: overrides. */
export function mergeGroups(maps: ReadonlyArray<BreakpointGroups>): string[] {
  const keys = new Set<string>();
  maps.forEach((m) => Object.keys(m.g).forEach((k) => keys.add(k)));
  const out: string[] = [];
  for (const k of keys) {
    let prev: string | undefined;
    for (const m of maps) {
      const v = m.g[k];
      const eff = v !== undefined ? v : (prev !== undefined && RESET[k] !== undefined ? RESET[k] : undefined);
      if (eff !== undefined && eff !== prev) { out.push((m.bp || '') + eff); prev = eff; }
      else if (eff === undefined) prev = undefined;
    }
  }
  return out;
}
