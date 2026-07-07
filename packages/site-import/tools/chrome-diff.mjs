// Pure STRUCTURAL diff for the clone-fidelity gate's CHROME (nav header + footer) — no browser, no I/O.
// The body diff (style-diff.mjs) matches by text and scores font/gradient; that can't score the dense nav
// (duplicate labels, no stable text on the logo/icons). Chrome is scored by LAYOUT instead: match elements
// within a region (header/footer) by text, then text-less ones (logo/icons) by left-to-right order, and
// compare x-position, width, height, background/gradient, colour and font. The x-position check is what
// catches a nav that's boxed in the container vs. the original's full-width bar (logo x=392 vs x=11).
import { firstFamily, stripWs, weightNum, skewDeg, lsPx, radiusPx, hasShadow } from './style-diff.mjs';

/** Group a flat element list by chrome region, each sorted left-to-right (then top-down). */
function byRegion(items, region) {
  return items.filter((e) => e.region === region).sort((a, b) => a.x - b.x || a.y - b.y);
}

/**
 * Match ORIGINAL↔CLONE chrome elements within each region: text-bearing ones by normalized text (1:1),
 * then the remaining text-less ones (logo img, icon-only buttons) by left-to-right order. Returns matched
 * {region,o,c} pairs + the originals with no clone counterpart (missing chrome).
 */
export function matchChrome(orig, clone, regions = ['header', 'footer']) {
  const pairs = [];
  const unmatched = [];
  for (const region of regions) {
    const O = byRegion(orig, region);
    const C = byRegion(clone, region);
    const usedC = new Set();
    const matchedO = new Set();
    // pass 1 — by text (case-insensitive), 1:1
    for (const o of O) {
      if (!o.text) continue;
      const c = C.find((x) => !usedC.has(x) && x.text && x.text.toLowerCase() === o.text.toLowerCase());
      if (c) { usedC.add(c); matchedO.add(o); pairs.push({ region, o, c }); }
    }
    // pass 2 — text-less (logo/icons) by order
    const remO = O.filter((o) => !matchedO.has(o) && !o.text);
    const remC = C.filter((c) => !usedC.has(c) && !c.text);
    for (let i = 0; i < remO.length; i++) {
      if (remC[i]) { pairs.push({ region, o: remO[i], c: remC[i] }); usedC.add(remC[i]); matchedO.add(remO[i]); }
    }
    for (const o of O) if (!matchedO.has(o)) unmatched.push(o);
  }
  return { pairs, unmatched };
}

/**
 * Score matched chrome pairs by LAYOUT + style divergence. Flags: x-position off by > `maxPosDx` px (the
 * full-width/container bug), width or height off by > `maxSizeRatio`×, a missing/different gradient or fill
 * on a button/tab, a colour change, or a font-family change. PASS needs zero position breaches, ≤1 size and
 * ≤1 style breach, and coverage ≥ `minCoverage` of the original's chrome elements.
 */
export function scoreChrome(match, opts = {}) {
  const {
    maxPosDx = 40, maxSizeRatio = 1.25, minCoverage = 0.85,
    maxSkewDeg = 4, minWeightDelta = 150, maxLsDx = 0.6, maxRadiusDx = 3,
  } = opts;
  const diffs = [];
  let posOff = 0, sizeOff = 0, styleOff = 0;
  for (const { region, o, c } of match.pairs) {
    const props = [];
    if (Math.abs((o.x ?? 0) - (c.x ?? 0)) > maxPosDx) { props.push(`x:${Math.round(o.x)}→${Math.round(c.x)}`); posOff++; }
    if (o.w && c.w && Math.max(o.w, c.w) / Math.min(o.w, c.w) > maxSizeRatio) { props.push(`w:${Math.round(o.w)}→${Math.round(c.w)}`); sizeOff++; }
    if (o.h && c.h && Math.max(o.h, c.h) / Math.min(o.h, c.h) > maxSizeRatio) { props.push(`h:${Math.round(o.h)}→${Math.round(c.h)}`); sizeOff++; }
    if (firstFamily(o.font) !== firstFamily(c.font)) { props.push(`font:${firstFamily(o.font)}→${firstFamily(c.font)}`); styleOff++; }
    // SKEW — the parallelogram angle. 15°-vs-25° read as "close" but is a real, visible mismatch the old
    // gate never saw (it captured `transform` but never compared it).
    if (Math.abs(skewDeg(o.transform) - skewDeg(c.transform)) > maxSkewDeg) { props.push(`skew:${skewDeg(o.transform)}°→${skewDeg(c.transform)}°`); styleOff++; }
    // FONT-WEIGHT — bold-vs-400 (only family was compared before, so weight slipped through).
    if (Math.abs(weightNum(o.weight) - weightNum(c.weight)) >= minWeightDelta) { props.push(`weight:${weightNum(o.weight)}→${weightNum(c.weight)}`); styleOff++; }
    // LETTER-SPACING — the nav's 1px tracking vs a re-authored `tracking-wide`.
    if (Math.abs(lsPx(o.ls, o.size) - lsPx(c.ls, c.size)) > maxLsDx) { props.push(`ls:${o.ls || 'normal'}→${c.ls || 'normal'}`); styleOff++; }
    // BORDER-RADIUS — the tab corner radius (5px original vs a guessed value).
    if (Math.abs(radiusPx(o.radius) - radiusPx(c.radius)) > maxRadiusDx) { props.push(`radius:${o.radius}→${c.radius}`); styleOff++; }
    // gradient / fill / shadow only where it's meaningful (a tab/button)
    if (o.role === 'button') {
      const og = /gradient/i.test(o.bgImage || ''), cg = /gradient/i.test(c.bgImage || '');
      if (og && !cg) { props.push('gradient:MISSING'); styleOff++; }
      else if (!og && cg) { props.push('gradient:EXTRA(orig-solid)'); styleOff++; } // solid→gradient: the exact "added gradients where the original is flat" bug
      else if (og && cg && stripWs(o.bgImage) !== stripWs(c.bgImage)) { props.push('gradient:DIFF'); styleOff++; }
      else if (!og && !cg && o.bg !== c.bg) { props.push(`fill:${o.bg}→${c.bg}`); styleOff++; }
      // BOX-SHADOW presence — the tab drop-shadow that makes the skewed chip read as raised.
      if (hasShadow(o.shadow) !== hasShadow(c.shadow)) { props.push(`shadow:${hasShadow(o.shadow) ? 'has' : 'none'}→${hasShadow(c.shadow) ? 'has' : 'none'}`); styleOff++; }
    }
    if (o.color && c.color && o.color !== c.color) props.push(`color:${o.color}→${c.color}`); // reported, not gated (AA-ish)
    // HOVER — the original element changes on hover (bg/gradient/colour) but the clone stays flat ⇒ missing
    // effect. REPORTED, not gated: the hover pass drives a real mouse over the preview shell and can miss
    // (scroll-container coords), so a false "missing" must not fail the gate — surface it for the author to check.
    if (o.hover) {
      const oHover = o.hover.bgImage !== (o.bgImage || '').slice(0, 140) || o.hover.bg !== o.bg || o.hover.color !== o.color;
      const cHover = c.hover && (c.hover.bgImage !== (c.bgImage || '').slice(0, 140) || c.hover.bg !== c.bg || c.hover.color !== c.color);
      if (oHover && !cHover) props.push('hover:MISSING?');
    }
    if (props.length) diffs.push({ region, label: o.text || `[${o.tag}]`, props });
  }
  const origCount = match.pairs.length + match.unmatched.length;
  const coverage = origCount ? match.pairs.length / origCount : 0;
  // Zero tolerance on FLAGGED breaches — each per-check threshold (maxPosDx, maxSizeRatio) already lets minor
  // diffs pass unflagged, so anything flagged is a real, beyond-tolerance mismatch the clone must fix.
  const pass = posOff === 0 && sizeOff === 0 && styleOff === 0 && coverage >= minCoverage;
  return { matched: match.pairs.length, origCount, coverage, posOff, sizeOff, styleOff, diffs, unmatched: match.unmatched, pass };
}

/**
 * Score CHROME-LEVEL structure the per-element diff can't see, because it's a property of the whole bar or a
 * behaviour rather than a single matched element:
 *  - header POSITION — a `fixed`/`sticky` pinned bar vs a static one (the original nav stays pinned on scroll),
 *  - RIPPLE — the click ripple the original fires on every tab/button (Materialize `waves` / a ripple runtime),
 *  - MODAL triggers — nav icons/buttons that open a modal (mail→contact, info→about, REQUEST QUOTE→quote).
 * Each side's `meta` = `{ position:string, ripple:number, modalTriggers:number }` captured once per page.
 * Only flags a REGRESSION (original has it, clone lacks it) — an extra ripple/modal in the clone is fine.
 */
export function scoreChromeMeta(o = {}, c = {}) {
  const diffs = [];
  const oPinned = /fixed|sticky/.test(o.position || ''), cPinned = /fixed|sticky/.test(c.position || '');
  if (oPinned && !cPinned) diffs.push(`header-position:${o.position || 'static'}→${c.position || 'static'} (not pinned)`);
  if ((o.ripple || 0) > 0 && (c.ripple || 0) === 0) diffs.push(`ripple:MISSING (original fires ${o.ripple})`);
  if ((o.modalTriggers || 0) > 0 && (c.modalTriggers || 0) === 0) diffs.push(`modals:MISSING (original has ${o.modalTriggers} nav modal trigger(s))`);
  return { diffs, metaOff: diffs.length, pass: diffs.length === 0 };
}
