// Pure computed-style diff for the clone-fidelity gate — no browser, no I/O, so it is unit-testable.
// The browser-driving CLI (fidelity-gate.mjs) captures an array of {role,tag,text,font,size,weight,color,
// bg,bgImage,shadow,transform,radius} per side, then hands them here to match by text and score divergence.

/** First font-family in a `font-family` list, unquoted + lowercased (what actually renders). The extra
 *  `.trim()` after the split drops the space that can precede a comma (`Arial , sans` → `arial`). */
export const firstFamily = (f) => (f || '').replace(/\s+/g, ' ').trim().split(',')[0].trim().replace(/['"]/g, '').toLowerCase();
/** Whitespace-stripped (so `linear-gradient( a , b )` compares equal to `linear-gradient(a,b)`). */
export const stripWs = (s) => (s || '').replace(/\s+/g, '');

/**
 * Match each ORIGINAL element to a CLONE element by normalized text (same-role preferred, greedy 1:1),
 * and record the per-element computed-style divergences that matter for fidelity:
 *  - font-family (the recurring "wrong/invisible display font" bug),
 *  - gradient / fill on headings+buttons (the recurring "gradients not reused" bug),
 *  - skew(transform) + box-shadow presence on buttons (the recurring "inconsistent buttons" bug),
 *  - heading font-size ratio (>1.2× ⇒ visibly wrong scale).
 * Unmatched originals ⇒ content missing/renamed in the clone (the recurring "dropped modal/section" bug).
 * @returns {{matched:number, origCount:number, diffs:Array<{role,text,props:string[]}>, unmatched:Array}}
 */
export function matchAndDiff(orig, clone) {
  const byText = new Map();
  for (const c of clone) { const k = c.text.toLowerCase(); if (!byText.has(k)) byText.set(k, []); byText.get(k).push(c); }
  const diffs = [];
  const unmatched = [];
  let matched = 0;
  for (const o of orig) {
    const cand = byText.get(o.text.toLowerCase());
    if (!cand || !cand.length) { unmatched.push(o); continue; }
    let i = cand.findIndex((c) => c.role === o.role);
    if (i < 0) i = 0;
    const c = cand.splice(i, 1)[0];
    matched++;
    const props = [];
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

/** Aggregate a match result into gate metrics + a hard PASS/FAIL. Thresholds are conservative defaults.
 *  `gradFail` counts BOTH a missing AND a differing gradient (either breaks fidelity). */
export function scorePage(r, opts = {}) {
  const { minCoverage = 0.85, maxFontMiss = 0, maxGradFail = 1, maxScore = 0.12 } = opts;
  const has = (pfx) => (d) => d.props.some((p) => p.startsWith(pfx));
  const fontMiss = r.diffs.filter(has('font:')).length;
  const gradFail = r.diffs.filter(has('gradient')).length; // gradient:MISSING or gradient:DIFF
  const skewMiss = r.diffs.filter(has('transform')).length;
  const coverage = r.origCount ? r.matched / r.origCount : 0;
  const score = r.diffs.length / Math.max(1, r.matched); // divergences per matched element
  const pass = coverage >= minCoverage && fontMiss <= maxFontMiss && gradFail <= maxGradFail && score < maxScore;
  return { coverage, matched: r.matched, origCount: r.origCount, fontMiss, gradFail, skewMiss, diffCount: r.diffs.length, score, pass };
}
