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
    let leaf = el;
    while (true) { const k = [...leaf.children].filter((c) => n(c.textContent)); if (k.length === 1 && n(k[0].textContent) === textFull) leaf = k[0]; else break; }
    const lcs = getComputedStyle(leaf);
    out.push({ role, tag, text, region, x: Math.round(r.left), y: Math.round(absY), w: Math.round(r.width), h: Math.round(r.height), font: lcs.fontFamily, size: lcs.fontSize, weight: lcs.fontWeight, ls: lcs.letterSpacing, color: lcs.color, bg: cs.backgroundColor, bgImage: cs.backgroundImage.slice(0, 240), shadow: cs.boxShadow.slice(0, 140), transform: cs.transform, radius: cs.borderRadius });
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
/* v8 ignore stop */
