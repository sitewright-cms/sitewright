// @ts-nocheck
/* v8 ignore start -- these run in the BROWSER via page.evaluate (serialized by Playwright), never in Node;
   the API tsconfig has no DOM lib so this file is intentionally unchecked + coverage-exempt. Each function
   MUST be self-contained (no closure refs) so page.evaluate(fn) can serialize it. Kept byte-identical in
   intent to the CLI gate's EXTRACT/CHROME_META (packages/site-import/tools/fidelity-gate.mjs) so the
   server-side `fidelity_check` MCP tool and the local CLI measure the SAME thing. */

/**
 * Meaningful elements + computed styles + region (header/footer/body) + layout box, for the fidelity diff.
 * BODY keeps text-bearing headings/buttons/text; CHROME (header/footer) also keeps the text-less logo img +
 * icon-only buttons/links. Font/size read from the deepest element holding the full text (the LEAF).
 */
export function FIDELITY_EXTRACT() {
  const n = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const H = 95;
  const vpW = document.documentElement.clientWidth || 1920;
  const sy = window.scrollY || 0;
  let pageH = document.documentElement.scrollHeight;
  for (const e of document.querySelectorAll('body *')) { const b = e.getBoundingClientRect().bottom + sy; if (b > pageH) pageH = b; }
  const footTop = pageH - 650;
  const out = [];
  for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6,a,button,p,li,img,[class*="btn"]')) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (r.right < 4 || r.left > vpW - 4 || r.bottom < 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue;
    const absY = r.top + (window.scrollY || 0);
    const region = absY < H ? 'header' : absY > footTop ? 'footer' : 'body';
    const tag = el.tagName.toLowerCase();
    const text = tag === 'img' ? '' : n(el.textContent).slice(0, 60);
    const heading = /^h[1-6]$/.test(tag);
    const btn = tag === 'button' || (tag === 'a' && (/btn|button/i.test(el.className) || cs.backgroundImage !== 'none' || cs.backgroundColor !== 'rgba(0, 0, 0, 0)'));
    let role = heading ? 'heading' : btn ? 'button' : (tag === 'p' || tag === 'li') ? 'text' : tag === 'img' ? 'img' : 'other';
    if (region === 'body') {
      if (role === 'other' || role === 'img' || !text || text.length < 2) continue;
    } else {
      if (role === 'other' && !(tag === 'a' || tag === 'button')) continue;
      if (role === 'other') role = 'button';
    }
    const textFull = n(el.textContent);
    // Skip a nested LABEL / counter-skew wrapper inside an <a>/<button> that carries the SAME text: the
    // enclosing interactive element already represents it. Measuring the inner span reads ITS box + radius
    // (a skewed button counter-skews its label → radius 0, not the button's 5px) and double-counts the
    // label, which is exactly what destabilised text-matching + reported a wrong-node radius diff.
    const wrap = el.closest('a,button');
    if (wrap && wrap !== el && n(wrap.textContent) === textFull) continue;
    let leaf = el;
    while (true) { const k = [...leaf.children].filter((c) => n(c.textContent)); if (k.length === 1 && n(k[0].textContent) === textFull) leaf = k[0]; else break; }
    const lcs = getComputedStyle(leaf);
    // EFFECTIVE transform: an author may put the skew on a wrapper (the element itself reads `none`) — walk
    // up to 2 ancestors so both sides report the skew that actually paints, wherever it lives. Without this
    // the diff flip-flops when original and clone attach the same skew at different depths.
    let tf = cs.transform;
    if (!tf || tf === 'none') {
      let anc = el.parentElement;
      for (let i = 0; i < 2 && anc; i++, anc = anc.parentElement) {
        const at = getComputedStyle(anc).transform;
        if (at && at !== 'none') { tf = at; break; }
      }
    }
    // clip-path: a polygon parallelogram is the platform's skew primitive — captured so the diff can treat
    // it as skew-equivalent (gate.ts effSkewDeg) instead of reporting transform:MISSING.
    const clip = cs.clipPath && cs.clipPath !== 'none' ? cs.clipPath.slice(0, 160) : undefined;
    // w/h from OFFSET dims (untransformed border-box, integer, STABLE) not getBoundingClientRect (which
    // includes the skew transform → the axis-aligned box inflates run-to-run: the 45↔73 height jitter that
    // made the gate non-convergent). x/y stay viewport-relative (rect). Inline el → offset* 0 → fall back.
    out.push({ role, tag, text, region, x: Math.round(r.left), y: Math.round(absY), w: el.offsetWidth || Math.round(r.width), h: el.offsetHeight || Math.round(r.height), font: lcs.fontFamily, size: lcs.fontSize, weight: lcs.fontWeight, ls: lcs.letterSpacing, color: lcs.color, bg: cs.backgroundColor, bgImage: cs.backgroundImage.slice(0, 240), shadow: cs.boxShadow.slice(0, 140), transform: tf, radius: cs.borderRadius, clip });
  }
  return out;
}

/**
 * Per-page font FINGERPRINTS: first font-family of every text-bearing element → the rendered width of a fixed
 * pangram at 100px in that family. Two family NAMES that load the same glyphs (an imported original serves
 * its face as "primary-font"; the clone declares the real name) measure identically — the diff uses this to
 * suppress name-only font mismatches (gate.ts sameFace) instead of flagging a false fontMiss. Waits for
 * document.fonts so a face still loading doesn't fingerprint as the fallback.
 */
export async function FIDELITY_FONTS() {
  try { await document.fonts.ready; } catch { /* measure with whatever painted */ }
  const first = (f) => (f || '').split(',')[0].trim().replace(/['"]/g, '').toLowerCase();
  const fams = new Set();
  for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6,a,button,p,li')) fams.add(first(getComputedStyle(el).fontFamily));
  const ctx = document.createElement('canvas').getContext('2d');
  const out = {};
  if (!ctx) return out;
  for (const fam of fams) {
    if (!fam) continue;
    const spec = `100px "${fam.replace(/"/g, '')}"`;
    // Fingerprint ONLY families the browser confirms are resolvable: an unavailable family silently
    // measures as the generic fallback, and two DIFFERENT failed fonts would fingerprint identically —
    // sameFace would then hide a real "the clone's font never loaded" defect. An unconfirmed family is
    // OMITTED, so the diff falls back to strict name comparison (fails closed, never masks).
    let loaded = false;
    try { loaded = document.fonts.check(spec); } catch { /* unsupported → strict names */ }
    if (!loaded) continue;
    ctx.font = spec;
    out[fam] = Math.round(ctx.measureText('Sphinx of black quartz judge my vow 0123456789').width);
  }
  return out;
}

/**
 * Whole-bar / behavioural CHROME facts the per-element diff can't see: is the header pinned (fixed/sticky),
 * does the chrome fire click ripple, and does the nav open modals. Counted across header + footer. The SW
 * ripple runtime uses the SAME `waves-effect` protocol as the source, so one selector covers both. A modal
 * trigger counts only if the element it targets is actually a modal (resolve the id, match `.modal`/
 * `cb-modal`/`#…-modal`), so a Bootstrap dropdown/tab `data-target` or a plain `#anchor` isn't miscounted.
 */
export function FIDELITY_META() {
  const header = document.querySelector('#main-nav, header, nav');
  const roots = [header, document.querySelector('#footer, footer')].filter(Boolean);
  const isModal = (el) => Boolean(el) && (el.getAttribute('data-sw-component') === 'modal' || /modal/i.test(el.className || '') || /modal/i.test(el.id || ''));
  const targetOf = (el) => { const raw = el.getAttribute('data-target') || el.getAttribute('data-bs-target') || el.getAttribute('data-sw-open') || el.getAttribute('data-sw-modal') || el.getAttribute('data-sw-modal-open') || el.getAttribute('href') || ''; return raw ? document.getElementById(raw.replace(/^#/, '')) : null; };
  let ripple = 0, modalTriggers = 0;
  for (const root of roots) {
    ripple += root.querySelectorAll('.waves-effect, [class~="ripple"], .sw-btn-fx-ripple, [data-sw-ripple]').length;
    for (const el of root.querySelectorAll('[data-target], [data-bs-target], [data-sw-open], [data-sw-modal], [data-sw-modal-open], .modal-trigger, a[href^="#"]')) {
      if (el.classList.contains('modal-trigger') || isModal(targetOf(el))) modalTriggers++;
    }
  }
  return { position: header ? getComputedStyle(header).position : 'static', ripple, modalTriggers };
}

/**
 * Scroll the first element matching `sel` into view and return its viewport-relative bounding box (rounded,
 * clamped to >=0) — for the high-res region-compare crop. Returns null if nothing matches. The scroll is
 * instant (synchronous layout), so the box read immediately after is accurate.
 */
export function REGION_BOX(sel) {
  const el = document.querySelector(sel);
  if (!el) return null;
  el.scrollIntoView({ block: 'start', inline: 'nearest' });
  const r = el.getBoundingClientRect();
  return { x: Math.max(0, Math.round(r.x)), y: Math.max(0, Math.round(r.y)), w: Math.round(r.width), h: Math.round(r.height) };
}
/* v8 ignore stop */
