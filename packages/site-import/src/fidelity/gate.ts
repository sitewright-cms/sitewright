// Pure clone-fidelity DIFF logic — no browser, no I/O, so both the CLI gate (packages/site-import/tools)
// AND the server-side MCP `fidelity_check` tool share ONE implementation. The browser-driving caller captures
// an array of computed-style elements per side (original + clone) and hands them here to match + score.
//
// BODY  (matchAndDiff / scorePage): match text-bearing headings/buttons/text by text, score font + gradient.
// CHROME (matchChrome / scoreChrome / scoreChromeMeta): the dense nav has duplicate labels + text-less
// logo/icons, so it's scored by LAYOUT (x/w/h) + per-element style (skew, weight, letter-spacing, radius,
// shadow, gradient/fill) + whole-bar meta (fixed position, ripple, modal triggers).

// ─── shared computed-style parsers ────────────────────────────────────────────────────────────────────
/** First font-family in a `font-family` list, unquoted + lowercased (what actually renders). */
export const firstFamily = (f: string): string => (f || '').replace(/\s+/g, ' ').trim().split(',')[0]!.trim().replace(/['"]/g, '').toLowerCase();
/** Whitespace-stripped (so `linear-gradient( a , b )` compares equal to `linear-gradient(a,b)`). */
export const stripWs = (s: string): string => (s || '').replace(/\s+/g, '');
/** Numeric font-weight (`normal`→400, `bold`→700, else the number) — so 400-vs-700 is comparable. */
export const weightNum = (w: string | number | null | undefined): number => { const s = String(w ?? '').toLowerCase().trim(); if (s === 'normal') return 400; if (s === 'bold') return 700; const n = parseInt(s, 10); return Number.isFinite(n) ? n : 400; };
/** skewX angle in DEGREES from a computed `transform` matrix (`none`→0). Pure skewX = `matrix(1,0,tanθ,1,0,0)`
 *  → `atan2(c,a)`; immune to scale, and a pure rotation reads as -angle (a genuine transform diff worth flagging). */
export const skewDeg = (t: string | null | undefined): number => { const m = /matrix\(([^)]+)\)/.exec(t || ''); if (!m) return 0; const p = m[1]!.split(',').map(Number); if (p.length < 4 || !Number.isFinite(p[0])) return 0; return Math.round((Math.atan2(p[2]!, p[0]!) * 180) / Math.PI); };
/** letter-spacing in PX (`normal`→0; `em` resolved against the element's font-size). */
export const lsPx = (ls: string | null | undefined, size: string | null | undefined): number => { const s = String(ls ?? '').trim(); if (!s || s === 'normal') return 0; if (s.endsWith('em')) return (parseFloat(s) || 0) * (parseFloat(String(size ?? '')) || 16); return parseFloat(s) || 0; };
/** First (top-left) border-radius value in PX (`none`/empty→0). Only the first corner is compared — fine for
 *  symmetric tab corners; asymmetric-radius chrome would need per-corner fidelity. */
export const radiusPx = (r: string | null | undefined): number => { const s = String(r ?? '').trim(); if (!s || s === 'none') return 0; return parseFloat(s) || 0; };
/** Whether a computed `box-shadow` is present (not `none`/empty). */
export const hasShadow = (s: string | null | undefined): boolean => Boolean(s) && s !== 'none';
/** Median of a numeric list (empty → 0). Robust to outliers, so a single misplaced element doesn't move it. */
export const median = (xs: readonly number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
/** A background COLOUR that actually paints (not transparent). Reads the ALPHA channel from legacy
 *  `rgba(r, g, b, a)` (4th field) or CSS Color 4 `rgb(r g b / a)` (after the slash) so a zero-alpha of ANY
 *  colour is invisible — robust to the browser switching notations (not a brittle string compare). Any
 *  named/hex/3-component colour paints. */
export const isVisibleBg = (bg: string | null | undefined): boolean => {
  const s = (bg || '').trim().toLowerCase();
  if (!s || s === 'transparent') return false;
  const slash = /\/\s*([\d.]+)%?\s*\)$/.exec(s); // rgb(r g b / a) — alpha after the slash
  if (slash) return parseFloat(slash[1]!) !== 0;
  const rgba = /^rgba?\(([^)]+)\)$/.exec(s); // rgba(r, g, b, a) — alpha is the 4th comma field
  if (rgba) { const parts = rgba[1]!.split(',').map((x) => x.trim()); if (parts.length === 4) return parseFloat(parts[3]!) !== 0; }
  return true;
};
/** An element carries a MEANINGFUL fill — a gradient image or a non-transparent bg colour. Used to gate the
 *  fill/gradient diff on filled NON-button chrome (nav tab colours, the active-item pill) too, not just buttons. */
export const hasFill = (e: { bg?: string; bgImage?: string }): boolean => /gradient/i.test(e.bgImage || '') || isVisibleBg(e.bg);
/** Resolve one clip-path coordinate to px against a box dimension: `N%`, `Npx`, bare `N`, or the two calc
 *  forms Chromium serializes for skewed shapes (`calc(N% ± Mpx)`). Unknown forms → NaN (caller bails). */
const clipCoordPx = (raw: string, dim: number): number => {
  const s = raw.trim();
  const calc = /^calc\(\s*([\d.]+)%\s*([+-])\s*([\d.]+)px\s*\)$/.exec(s);
  if (calc) return (parseFloat(calc[1]!) / 100) * dim + (calc[2] === '+' ? 1 : -1) * parseFloat(calc[3]!);
  if (s.endsWith('%')) return (parseFloat(s) / 100) * dim;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
};
/** Effective skewX angle (degrees) of a 4-point `polygon()` clip-path parallelogram — how platform buttons
 *  build the skewed look WITHOUT a transform. Slant = the top-left corner's x offset vs the bottom-left's,
 *  over the polygon height; sign matches `skewX` (top shifted RIGHT of bottom = negative angle, like
 *  `skewX(-25°)`). Non-polygon / non-4-point / unparsable coords → 0 (no skew claimed). */
export const clipSkewDeg = (clip: string | null | undefined, w: number | undefined, h: number | undefined): number => {
  if (!clip || !w || !h) return 0;
  // Greedy to the LAST `)` — a coordinate may itself contain a paren (`calc(100% - 15px)`), so a
  // non-greedy/negated-class match would truncate the point list at the calc's closing paren.
  const m = /polygon\((.*)\)/.exec(clip);
  if (!m) return 0;
  const pts = m[1]!.split(',').map((p) => p.trim().split(/\s+(?![^(]*\))/)); // don't split inside calc(…)
  if (pts.length !== 4 || pts.some((p) => p.length < 2)) return 0;
  const xy = pts.map((p) => ({ x: clipCoordPx(p[0]!, w), y: clipCoordPx(p.slice(1).join(' '), h) }));
  if (xy.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return 0;
  const ys = xy.map((p) => p.y);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const height = maxY - minY;
  if (height < 4) return 0;
  const top = xy.filter((p) => Math.abs(p.y - minY) < 2), bottom = xy.filter((p) => Math.abs(p.y - maxY) < 2);
  if (top.length !== 2 || bottom.length !== 2) return 0;
  const dx = Math.min(top[0]!.x, top[1]!.x) - Math.min(bottom[0]!.x, bottom[1]!.x);
  return Math.round((-Math.atan2(dx, height) * 180) / Math.PI);
};
/** The skew an element actually SHOWS: its transform matrix skew, else the slant of its clip-path
 *  parallelogram. Lets a clone that builds the skewed look with `clip-path` (the platform primitive) match an
 *  original that uses `transform: skew` — visually equivalent implementations must not diff. */
export const effSkewDeg = (e: { transform?: string; clip?: string; w?: number; h?: number }): number =>
  skewDeg(e.transform) || clipSkewDeg(e.clip, e.w, e.h);
/** Per-page font fingerprints: firstFamily → rendered pangram width (px). Two family NAMES that render the
 *  same glyphs (an imported site serves its face as "primary-font"; the clone declares "orbitron") measure
 *  identically, so the diff can suppress the name-only mismatch instead of flagging a false fontMiss. */
export type FontMetrics = Record<string, number>;
/** Whether two computed font-family lists render the SAME face: equal first-family names, or (when both
 *  sides' pages measured the family) pangram widths within 2%. Missing metrics → names must match. */
export const sameFace = (oFont: string, cFont: string, oM?: FontMetrics, cM?: FontMetrics): boolean => {
  const of = firstFamily(oFont), cf = firstFamily(cFont);
  if (of === cf) return true;
  const ow = oM?.[of], cw = cM?.[cf];
  if (!ow || !cw) return false;
  return Math.abs(ow - cw) / Math.max(ow, cw) <= 0.02;
};

// ─── types ────────────────────────────────────────────────────────────────────────────────────────────
export interface StyleEl {
  role: 'heading' | 'button' | 'text' | 'other';
  tag: string; text: string;
  font: string; size: string; weight: string; color: string;
  bg: string; bgImage: string; shadow: string; transform: string; radius: string;
  /** letter-spacing (computed). Optional — the body diff doesn't compare it. */
  ls?: string;
  /** Absolute document y (px) — lets the body matcher pick the NEAREST same-text candidate instead of the
   *  first, so a repeated label (a card button vs a footer link) can't cross-pair and report bogus diffs. */
  y?: number;
  /** Untransformed border-box dims — needed to resolve %-based clip-path coords to a skew angle. */
  w?: number; h?: number;
  /** Computed clip-path when not `none` — a polygon parallelogram here counts as a skew (see effSkewDeg). */
  clip?: string;
}
/** Per-side page fonts for the alias check, passed alongside the element arrays. */
export interface FontsOpt { orig?: FontMetrics; clone?: FontMetrics }
export interface HoverState { bg: string; bgImage: string; color: string }
export interface ChromeEl extends StyleEl {
  region: 'header' | 'footer' | 'body';
  x: number; y: number; w: number; h: number;
  hover?: HoverState;
}
export interface StyleDiff { role: string; text: string; props: string[] }
export interface MatchResult { matched: number; origCount: number; diffs: StyleDiff[]; unmatched: StyleEl[] }
export interface GateThresholds { minCoverage?: number; maxFontMiss?: number; maxGradFail?: number; maxScore?: number }
export interface GateScore { coverage: number; matched: number; origCount: number; fontMiss: number; gradFail: number; skewMiss: number; diffCount: number; score: number; pass: boolean }
export interface ChromePair { region: 'header' | 'footer'; o: ChromeEl; c: ChromeEl }
export interface ChromeMatch { pairs: ChromePair[]; unmatched: ChromeEl[] }
export interface ChromeDiff { region: string; label: string; props: string[] }
export interface ChromeThresholds { maxPosDx?: number; maxSizeRatio?: number; minCoverage?: number; maxSkewDeg?: number; minWeightDelta?: number; maxLsDx?: number; maxRadiusDx?: number; fonts?: FontsOpt }
export interface ChromeScore { matched: number; origCount: number; coverage: number; posOff: number; sizeOff: number; styleOff: number; diffs: ChromeDiff[]; unmatched: ChromeEl[]; pass: boolean }
export interface ChromeMeta { position?: string; ripple?: number; modalTriggers?: number }
export interface ChromeMetaScore { diffs: string[]; metaOff: number; pass: boolean }

// ─── BODY diff ────────────────────────────────────────────────────────────────────────────────────────
/** Match each original element to a clone element by normalized text (same-role preferred; among same-text
 *  candidates the NEAREST by document y wins — a page repeating a label, e.g. a card button and a footer
 *  link both reading "GET A QUOTE", must not cross-pair and report the other element's fill/gradient as a
 *  bogus diff) and record the font/gradient/fill divergences that matter for body fidelity. */
export function matchAndDiff(orig: StyleEl[], clone: StyleEl[], fonts: FontsOpt = {}): MatchResult {
  const byText = new Map<string, StyleEl[]>();
  for (const c of clone) { const k = c.text.toLowerCase(); if (!byText.has(k)) byText.set(k, []); byText.get(k)!.push(c); }
  const diffs: StyleDiff[] = [];
  const unmatched: StyleEl[] = [];
  let matched = 0;
  // Nearest same-text candidate by |Δy|, preferring same-role. y is absolute document px on both sides — a
  // cross-section pair differs by hundreds/thousands of px, the true counterpart by little, so plain distance
  // is enough. Candidates without y (older extracts) rank by insertion order (distance 0), preserving the old
  // greedy behaviour for them.
  const nearest = (o: StyleEl, cand: StyleEl[]): number => {
    let best = -1, bestD = Infinity, bestRole = false;
    for (let i = 0; i < cand.length; i++) {
      const c = cand[i]!;
      const d = o.y !== undefined && c.y !== undefined ? Math.abs(o.y - c.y) : 0;
      const roleHit = c.role === o.role;
      if (best < 0 || (roleHit && !bestRole) || (roleHit === bestRole && d < bestD)) { best = i; bestD = d; bestRole = roleHit; }
    }
    return best;
  };
  for (const o of orig) {
    const cand = byText.get(o.text.toLowerCase());
    if (!cand || !cand.length) { unmatched.push(o); continue; }
    const c = cand.splice(nearest(o, cand), 1)[0]!;
    matched++;
    const props: string[] = [];
    if (!sameFace(o.font, c.font, fonts.orig, fonts.clone)) props.push(`font:${firstFamily(o.font)}→${firstFamily(c.font)}`);
    if (o.role === 'heading' || o.role === 'button') {
      const og = /gradient/i.test(o.bgImage || ''), cg = /gradient/i.test(c.bgImage || '');
      if (og && !cg) props.push('gradient:MISSING');
      else if (og && cg && stripWs(o.bgImage) !== stripWs(c.bgImage)) props.push('gradient:DIFF');
      else if (!og && o.role === 'button' && o.bg !== c.bg) props.push(`fill:${o.bg}→${c.bg}`);
      // A clone that builds the skewed look with a clip-path parallelogram (the platform primitive) has no
      // transform — effSkewDeg treats it as skew-present, so only a genuinely straight clone flags.
      if (o.transform && o.transform !== 'none' && (!c.transform || c.transform === 'none') && effSkewDeg(c) === 0) props.push('transform:MISSING(skew?)');
      if (o.shadow && o.shadow !== 'none' && (!c.shadow || c.shadow === 'none')) props.push('shadow:MISSING');
    }
    if (o.role === 'heading') {
      const os = parseFloat(o.size), cs = parseFloat(c.size);
      if (os && cs && Math.max(os, cs) / Math.min(os, cs) > 1.2) props.push(`size:${o.size}→${c.size}`);
    }
    if (props.length) diffs.push({ role: o.role, text: o.text, props });
  }
  return { matched, origCount: orig.length, diffs, unmatched };
}

/** PASS/FAIL a page's BODY diff. Defaults: coverage≥0.85, fontMiss=0, gradFail≤1, score<0.12 (diffs/matched). */
export function scorePage(r: MatchResult, opts: GateThresholds = {}): GateScore {
  const { minCoverage = 0.85, maxFontMiss = 0, maxGradFail = 1, maxScore = 0.12 } = opts;
  const fontMiss = r.diffs.filter((d) => d.props.some((p) => p.startsWith('font:'))).length;
  const gradFail = r.diffs.filter((d) => d.props.some((p) => p.startsWith('gradient'))).length;
  const skewMiss = r.diffs.filter((d) => d.props.some((p) => p.startsWith('transform'))).length;
  const coverage = r.origCount ? r.matched / r.origCount : 0;
  const score = r.diffs.length / Math.max(1, r.matched);
  const pass = coverage >= minCoverage && fontMiss <= maxFontMiss && gradFail <= maxGradFail && score < maxScore;
  return { coverage, matched: r.matched, origCount: r.origCount, fontMiss, gradFail, skewMiss, diffCount: r.diffs.length, score, pass };
}

// ─── CHROME diff ──────────────────────────────────────────────────────────────────────────────────────
function byRegion(items: ChromeEl[], region: string): ChromeEl[] {
  return items.filter((e) => e.region === region).sort((a, b) => a.x - b.x || a.y - b.y);
}

/** Manhattan distance between two elements' top-left corners (px) — cheap position proximity for pairing. */
function elemDist(a: ChromeEl, b: ChromeEl): number {
  return Math.abs((a.x ?? 0) - (b.x ?? 0)) + Math.abs((a.y ?? 0) - (b.y ?? 0));
}
/** The UNUSED candidate nearest to `el` by position, or null. */
function nearestIn(el: ChromeEl, cands: ChromeEl[], used: Set<ChromeEl>): ChromeEl | null {
  let best: ChromeEl | null = null;
  let bestD = Infinity;
  for (const c of cands) {
    if (used.has(c)) continue;
    const d = elemDist(el, c);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

/** Match original↔clone chrome elements within each region: text elements by nearest same-text, then
 *  text-less ones (logo/icons) by MUTUAL nearest same-tag position — never by array index (which mis-paired
 *  the logo with a nav tab and reported its fill/skew/shadow as bogus diffs). */
export function matchChrome(
  orig: ChromeEl[],
  clone: ChromeEl[],
  regions: Array<'header' | 'footer'> = ['header', 'footer'],
): ChromeMatch {
  const pairs: ChromePair[] = [];
  const unmatched: ChromeEl[] = [];
  // Cap elements per region before the O(n²) proximity matching — bounds worst-case cost on an adversarial
  // source page (hundreds of stacked nav anchors) while staying far above any real chrome bar (~5–30 items).
  const MAX_PER_REGION = 400;
  // Max Manhattan distance for a PASS-2 text-less fallback pair (see the two-pass comment below). Dense
  // clusters strand elements only a pitch or two away; a far "nearest unused" is not a real counterpart. NB:
  // this is Manhattan (|dx|+|dy|), so an element that shifts in BOTH axes (e.g. a hamburger into a taller band)
  // can exceed it and go unmatched — a benign coverage drop, not a garbage diff. Header/footer chrome shares a
  // horizontal bar (dy≈0), so in practice it gates on x.
  const FALLBACK_MAX_DIST = 80;
  for (const region of regions) {
    const O = byRegion(orig, region).slice(0, MAX_PER_REGION);
    const C = byRegion(clone, region).slice(0, MAX_PER_REGION);
    const usedC = new Set<ChromeEl>();
    const matchedO = new Set<ChromeEl>();
    // TEXT elements: match to the NEAREST same-text clone (not the first — a header can repeat a label across
    // desktop/mobile navs, and a stray far match would report bogus x/size/skew diffs).
    for (const o of O) {
      if (!o.text) continue;
      const label = o.text.toLowerCase();
      const c = nearestIn(o, C.filter((x) => !!x.text && x.text.toLowerCase() === label), usedC);
      if (c) { usedC.add(c); matchedO.add(o); pairs.push({ region, o, c }); }
    }
    // TEXT-LESS elements (logo, icon tabs) — two passes so we neither mis-pair nor falsely strand:
    // PASS 1 pairs only a MUTUAL nearest same-tag correspondence (o's nearest is c AND c's nearest is o), so a
    // logo <a> is never linked to a nav-tab <a> just because they share a tag (the old array-index bug). PASS 2
    // recovers any element PASS 1 stranded — but ONLY to a NEARBY still-unused clone (`FALLBACK_MAX_DIST`): a
    // dense cluster (footer icons at ~40px pitch) can strand a valid element when a neighbour was slightly closer
    // to its clone, and there the only remaining clone is genuinely CLOSE. A FAR "nearest unused" is not a real
    // counterpart — force-matching it just manufactures garbage skew/fill/font diffs — so leave it unmatched.
    // (Container-shift, a legit FAR move, is still caught: those elements MUTUAL-match in pass 1.) `nearestIn`
    // breaks a distance tie by document order (leftmost), deterministically.
    for (const o of O) {
      if (o.text || matchedO.has(o)) continue;
      const c = nearestIn(o, C.filter((x) => !x.text && x.tag === o.tag), usedC);
      if (!c) continue;
      const backO = nearestIn(c, O.filter((x) => !x.text && x.tag === o.tag), matchedO);
      if (backO === o) { usedC.add(c); matchedO.add(o); pairs.push({ region, o, c }); }
    }
    for (const o of O) {
      if (o.text || matchedO.has(o)) continue;
      const c = nearestIn(o, C.filter((x) => !x.text && x.tag === o.tag), usedC);
      if (c && elemDist(o, c) <= FALLBACK_MAX_DIST) { usedC.add(c); matchedO.add(o); pairs.push({ region, o, c }); }
    }
    for (const o of O) if (!matchedO.has(o)) unmatched.push(o);
  }
  return { pairs, unmatched };
}

/** Score matched chrome pairs by layout + per-element style (skew/weight/ls/radius/shadow/gradient/fill). */
export function scoreChrome(match: ChromeMatch, opts: ChromeThresholds = {}): ChromeScore {
  const { maxPosDx = 40, maxSizeRatio = 1.25, minCoverage = 0.85, maxSkewDeg = 4, minWeightDelta = 150, maxLsDx = 0.6, maxRadiusDx = 3, fonts = {} } = opts;
  const diffs: ChromeDiff[] = [];
  let posOff = 0, sizeOff = 0, styleOff = 0;
  // A responsive rebuild can shift the WHOLE bar horizontally (a different container width, or centre vs
  // left align) — an exact-x gate then fails every element for one systematic offset. Gate x on each
  // element's deviation from its region's MEDIAN shift instead: a uniform shift is fidelity-preserving
  // (all pairs move together → 0 deviation), and only an element that moves RELATIVE to its neighbours
  // (reordered, mis-gapped) flags. Computed per region (header/footer shift independently).
  // Need ENOUGH elements for a reliable "uniform shift" — with 1-2 pairs the median IS that element's own
  // delta (deviation always 0), so a genuinely teleported lone element would escape. Below 3 pairs, fall
  // back to absolute-x gating (shift 0).
  const shiftByRegion = new Map<string, number>();
  for (const region of ['header', 'footer']) {
    // Filter non-finite deltas: a NaN from a broken/detached element's box would poison the sort + median
    // and silently suppress EVERY x-diff for the region (NaN comparisons are always false).
    const shifts = match.pairs.filter((p) => p.region === region).map((p) => (p.c.x ?? 0) - (p.o.x ?? 0)).filter(Number.isFinite);
    if (shifts.length >= 3) shiftByRegion.set(region, median(shifts));
  }
  for (const { region, o, c } of match.pairs) {
    const props: string[] = [];
    const shift = shiftByRegion.get(region) ?? 0;
    const relDx = ((c.x ?? 0) - (o.x ?? 0)) - shift;
    if (Math.abs(relDx) > maxPosDx) { props.push(`x:${Math.round(o.x)}→${Math.round(c.x)}${Math.abs(shift) > 2 ? ` (Δ${Math.round(relDx)} vs bar-shift ${Math.round(shift)})` : ''}`); posOff++; }
    if (o.w && c.w && Math.max(o.w, c.w) / Math.min(o.w, c.w) > maxSizeRatio) { props.push(`w:${Math.round(o.w)}→${Math.round(c.w)}`); sizeOff++; }
    if (o.h && c.h && Math.max(o.h, c.h) / Math.min(o.h, c.h) > maxSizeRatio) { props.push(`h:${Math.round(o.h)}→${Math.round(c.h)}`); sizeOff++; }
    if (!sameFace(o.font, c.font, fonts.orig, fonts.clone)) { props.push(`font:${firstFamily(o.font)}→${firstFamily(c.font)}`); styleOff++; }
    // Effective skew: transform matrix OR clip-path parallelogram slant — either side may implement the
    // slanted look either way (the platform's skewed buttons are clip-path). The clip-derived angle is a
    // geometric estimate, so allow double the tolerance when a clip supplied one of the angles.
    {
      const oSkew = effSkewDeg(o), cSkew = effSkewDeg(c);
      const viaClip = skewDeg(o.transform) !== oSkew || skewDeg(c.transform) !== cSkew;
      if (Math.abs(oSkew - cSkew) > (viaClip ? maxSkewDeg * 2 : maxSkewDeg)) { props.push(`skew:${oSkew}°→${cSkew}°`); styleOff++; }
    }
    if (Math.abs(weightNum(o.weight) - weightNum(c.weight)) >= minWeightDelta) { props.push(`weight:${weightNum(o.weight)}→${weightNum(c.weight)}`); styleOff++; }
    if (Math.abs(lsPx(o.ls, o.size) - lsPx(c.ls, c.size)) > maxLsDx) { props.push(`ls:${o.ls || 'normal'}→${c.ls || 'normal'}`); styleOff++; }
    if (Math.abs(radiusPx(o.radius) - radiusPx(c.radius)) > maxRadiusDx) { props.push(`radius:${o.radius}→${c.radius}`); styleOff++; }
    // Fill/gradient: gate for BUTTONS or any element with a meaningful bg on either side — so a nav TAB's
    // fill (a gray/coloured pill, the orange active HOME tab) is caught even when it renders as a plain
    // <li>/<a> (role text/other), not just a real button. Previously fill was button-only → tab colour
    // mismatches were invisible to the gate (only the region screenshot caught them).
    if (o.role === 'button' || hasFill(o) || hasFill(c)) {
      const og = /gradient/i.test(o.bgImage || ''), cg = /gradient/i.test(c.bgImage || '');
      if (og && !cg) { props.push('gradient:MISSING'); styleOff++; }
      else if (!og && cg) { props.push('gradient:EXTRA(orig-solid)'); styleOff++; }
      else if (og && cg && stripWs(o.bgImage) !== stripWs(c.bgImage)) { props.push('gradient:DIFF'); styleOff++; }
      else if (!og && !cg && o.bg !== c.bg) { props.push(`fill:${o.bg}→${c.bg}`); styleOff++; }
    }
    if (o.role === 'button' && hasShadow(o.shadow) !== hasShadow(c.shadow)) { props.push(`shadow:${hasShadow(o.shadow) ? 'has' : 'none'}→${hasShadow(c.shadow) ? 'has' : 'none'}`); styleOff++; }
    if (o.color && c.color && o.color !== c.color) props.push(`color:${o.color}→${c.color}`); // reported, not gated
    if (o.hover) {
      const oHover = o.hover.bgImage !== (o.bgImage || '').slice(0, 140) || o.hover.bg !== o.bg || o.hover.color !== o.color;
      const cHover = c.hover && (c.hover.bgImage !== (c.bgImage || '').slice(0, 140) || c.hover.bg !== c.bg || c.hover.color !== c.color);
      if (oHover && !cHover) props.push('hover:MISSING?'); // reported, not gated (mouse-move can miss)
    }
    if (props.length) diffs.push({ region, label: o.text || `[${o.tag}]`, props });
  }
  const origCount = match.pairs.length + match.unmatched.length;
  const coverage = origCount ? match.pairs.length / origCount : 0;
  const pass = posOff === 0 && sizeOff === 0 && styleOff === 0 && coverage >= minCoverage;
  return { matched: match.pairs.length, origCount, coverage, posOff, sizeOff, styleOff, diffs, unmatched: match.unmatched, pass };
}

/** Score whole-bar chrome facts the per-element diff can't see: pinned position, ripple, modal triggers.
 *  Only a REGRESSION flags (original has it, clone lacks it) — extra ripple/modals in the clone is fine. */
export function scoreChromeMeta(o: ChromeMeta = {}, c: ChromeMeta = {}): ChromeMetaScore {
  const diffs: string[] = [];
  const oPinned = /fixed|sticky/.test(o.position || ''), cPinned = /fixed|sticky/.test(c.position || '');
  if (oPinned && !cPinned) diffs.push(`header-position:${o.position || 'static'}→${c.position || 'static'} (not pinned)`);
  if ((o.ripple || 0) > 0 && (c.ripple || 0) === 0) diffs.push(`ripple:MISSING (original fires ${o.ripple})`);
  if ((o.modalTriggers || 0) > 0 && (c.modalTriggers || 0) === 0) diffs.push(`modals:MISSING (original has ${o.modalTriggers} nav modal trigger(s))`);
  return { diffs, metaOff: diffs.length, pass: diffs.length === 0 };
}
