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

// ─── types ────────────────────────────────────────────────────────────────────────────────────────────
export interface StyleEl {
  role: 'heading' | 'button' | 'text' | 'other';
  tag: string; text: string;
  font: string; size: string; weight: string; color: string;
  bg: string; bgImage: string; shadow: string; transform: string; radius: string;
  /** letter-spacing (computed). Optional — the body diff doesn't compare it. */
  ls?: string;
}
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
export interface ChromeThresholds { maxPosDx?: number; maxSizeRatio?: number; minCoverage?: number; maxSkewDeg?: number; minWeightDelta?: number; maxLsDx?: number; maxRadiusDx?: number }
export interface ChromeScore { matched: number; origCount: number; coverage: number; posOff: number; sizeOff: number; styleOff: number; diffs: ChromeDiff[]; unmatched: ChromeEl[]; pass: boolean }
export interface ChromeMeta { position?: string; ripple?: number; modalTriggers?: number }
export interface ChromeMetaScore { diffs: string[]; metaOff: number; pass: boolean }

// ─── BODY diff ────────────────────────────────────────────────────────────────────────────────────────
/** Match each original element to a clone element by normalized text (same-role preferred, greedy 1:1) and
 *  record the font/gradient/fill divergences that matter for body fidelity. */
export function matchAndDiff(orig: StyleEl[], clone: StyleEl[]): MatchResult {
  const byText = new Map<string, StyleEl[]>();
  for (const c of clone) { const k = c.text.toLowerCase(); if (!byText.has(k)) byText.set(k, []); byText.get(k)!.push(c); }
  const diffs: StyleDiff[] = [];
  const unmatched: StyleEl[] = [];
  let matched = 0;
  for (const o of orig) {
    const cand = byText.get(o.text.toLowerCase());
    if (!cand || !cand.length) { unmatched.push(o); continue; }
    let i = cand.findIndex((c) => c.role === o.role);
    if (i < 0) i = 0;
    const c = cand.splice(i, 1)[0]!;
    matched++;
    const props: string[] = [];
    if (firstFamily(o.font) !== firstFamily(c.font)) props.push(`font:${firstFamily(o.font)}→${firstFamily(c.font)}`);
    if (o.role === 'heading' || o.role === 'button') {
      const og = /gradient/i.test(o.bgImage || ''), cg = /gradient/i.test(c.bgImage || '');
      if (og && !cg) props.push('gradient:MISSING');
      else if (og && cg && stripWs(o.bgImage) !== stripWs(c.bgImage)) props.push('gradient:DIFF');
      else if (!og && o.role === 'button' && o.bg !== c.bg) props.push(`fill:${o.bg}→${c.bg}`);
      if (o.transform && o.transform !== 'none' && (!c.transform || c.transform === 'none')) props.push('transform:MISSING(skew?)');
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

/** Match original↔clone chrome elements within each region by text, then text-less ones (logo/icons) by order. */
export function matchChrome(orig: ChromeEl[], clone: ChromeEl[], regions: Array<'header' | 'footer'> = ['header', 'footer']): ChromeMatch {
  const pairs: ChromePair[] = [];
  const unmatched: ChromeEl[] = [];
  for (const region of regions) {
    const O = byRegion(orig, region);
    const C = byRegion(clone, region);
    const usedC = new Set<ChromeEl>();
    const matchedO = new Set<ChromeEl>();
    for (const o of O) {
      if (!o.text) continue;
      const c = C.find((x) => !usedC.has(x) && x.text && x.text.toLowerCase() === o.text.toLowerCase());
      if (c) { usedC.add(c); matchedO.add(o); pairs.push({ region, o, c }); }
    }
    const remO = O.filter((o) => !matchedO.has(o) && !o.text);
    const remC = C.filter((c) => !usedC.has(c) && !c.text);
    for (let i = 0; i < remO.length; i++) {
      if (remC[i]) { pairs.push({ region, o: remO[i]!, c: remC[i]! }); usedC.add(remC[i]!); matchedO.add(remO[i]!); }
    }
    for (const o of O) if (!matchedO.has(o)) unmatched.push(o);
  }
  return { pairs, unmatched };
}

/** Score matched chrome pairs by layout + per-element style (skew/weight/ls/radius/shadow/gradient/fill). */
export function scoreChrome(match: ChromeMatch, opts: ChromeThresholds = {}): ChromeScore {
  const { maxPosDx = 40, maxSizeRatio = 1.25, minCoverage = 0.85, maxSkewDeg = 4, minWeightDelta = 150, maxLsDx = 0.6, maxRadiusDx = 3 } = opts;
  const diffs: ChromeDiff[] = [];
  let posOff = 0, sizeOff = 0, styleOff = 0;
  for (const { region, o, c } of match.pairs) {
    const props: string[] = [];
    if (Math.abs((o.x ?? 0) - (c.x ?? 0)) > maxPosDx) { props.push(`x:${Math.round(o.x)}→${Math.round(c.x)}`); posOff++; }
    if (o.w && c.w && Math.max(o.w, c.w) / Math.min(o.w, c.w) > maxSizeRatio) { props.push(`w:${Math.round(o.w)}→${Math.round(c.w)}`); sizeOff++; }
    if (o.h && c.h && Math.max(o.h, c.h) / Math.min(o.h, c.h) > maxSizeRatio) { props.push(`h:${Math.round(o.h)}→${Math.round(c.h)}`); sizeOff++; }
    if (firstFamily(o.font) !== firstFamily(c.font)) { props.push(`font:${firstFamily(o.font)}→${firstFamily(c.font)}`); styleOff++; }
    if (Math.abs(skewDeg(o.transform) - skewDeg(c.transform)) > maxSkewDeg) { props.push(`skew:${skewDeg(o.transform)}°→${skewDeg(c.transform)}°`); styleOff++; }
    if (Math.abs(weightNum(o.weight) - weightNum(c.weight)) >= minWeightDelta) { props.push(`weight:${weightNum(o.weight)}→${weightNum(c.weight)}`); styleOff++; }
    if (Math.abs(lsPx(o.ls, o.size) - lsPx(c.ls, c.size)) > maxLsDx) { props.push(`ls:${o.ls || 'normal'}→${c.ls || 'normal'}`); styleOff++; }
    if (Math.abs(radiusPx(o.radius) - radiusPx(c.radius)) > maxRadiusDx) { props.push(`radius:${o.radius}→${c.radius}`); styleOff++; }
    if (o.role === 'button') {
      const og = /gradient/i.test(o.bgImage || ''), cg = /gradient/i.test(c.bgImage || '');
      if (og && !cg) { props.push('gradient:MISSING'); styleOff++; }
      else if (!og && cg) { props.push('gradient:EXTRA(orig-solid)'); styleOff++; }
      else if (og && cg && stripWs(o.bgImage) !== stripWs(c.bgImage)) { props.push('gradient:DIFF'); styleOff++; }
      else if (!og && !cg && o.bg !== c.bg) { props.push(`fill:${o.bg}→${c.bg}`); styleOff++; }
      if (hasShadow(o.shadow) !== hasShadow(c.shadow)) { props.push(`shadow:${hasShadow(o.shadow) ? 'has' : 'none'}→${hasShadow(c.shadow) ? 'has' : 'none'}`); styleOff++; }
    }
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
