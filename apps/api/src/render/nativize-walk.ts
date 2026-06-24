// @ts-nocheck
/* v8 ignore start -- these run in the browser via page.evaluate (serialized by Playwright), never in Node;
   the API tsconfig has no DOM lib so this file is intentionally unchecked + coverage-exempt. Ported from
   apps/editor/_clone.mjs (the matured nativizer spike). Each function must be SELF-CONTAINED (no closure
   refs) so page.evaluate(fn) can serialize it. */

/**
 * Walk the DOM at the CURRENT viewport into a styled tree. Structure (tags/text/attrs) is viewport-
 * independent; the style map `s` (plus the full-width / single-line flags folded in) is captured per
 * viewport so the merge step can emit responsive variants. Returns CapturedNode[] (see @sitewright/site-import).
 */
export function WALK(ROOT_SEL) {
  const INH = ['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'text-decoration-line', 'white-space'];
  const BOX = {
    'display': 'block', 'position': 'static', 'top': 'auto', 'right': 'auto', 'bottom': 'auto', 'left': 'auto', 'z-index': 'auto', 'float': 'none',
    'flex-direction': 'row', 'flex-wrap': 'nowrap', 'align-items': 'normal', 'align-self': 'auto', 'justify-content': 'normal', 'align-content': 'normal',
    'gap': 'normal', 'column-gap': 'normal', 'row-gap': 'normal', 'grid-template-columns': 'none', 'flex-grow': '0', 'flex-shrink': '1', 'flex-basis': 'auto', 'order': '0',
    'width': 'auto', 'height': 'auto', 'min-width': 'auto', 'min-height': 'auto', 'max-width': 'none', 'max-height': 'none', 'box-sizing': 'content-box', 'aspect-ratio': 'auto',
    'margin-top': '0px', 'margin-right': '0px', 'margin-bottom': '0px', 'margin-left': '0px',
    'padding-top': '0px', 'padding-right': '0px', 'padding-bottom': '0px', 'padding-left': '0px',
    'border-top-width': '0px', 'border-right-width': '0px', 'border-bottom-width': '0px', 'border-left-width': '0px', 'border-radius': '0px',
    'background-color': 'rgba(0, 0, 0, 0)', 'background-image': 'none', 'background-size': 'auto', 'background-position': '0% 0%', 'background-repeat': 'repeat',
    'box-shadow': 'none', 'opacity': '1', 'transform': 'none', 'overflow': 'visible', 'object-fit': 'fill', 'text-decoration-color': '',
  };
  const skip = new Set(['script', 'style', 'noscript', 'br', 'svg', 'path', 'use', 'link', 'meta']); // keep <i> — FontAwesome icons
  function walk(el, pcs) {
    const raw = el.tagName.toLowerCase(); if (skip.has(raw)) return null;
    // The platform OWNS the semantic landmarks (it wraps the page body + each chrome slot in
    // <nav>/<main>/<footer>/<aside>) and the no-JS validator rejects them inside a page source/slot.
    // Rename to <div> so nativized content + chrome both pass validation (<header> is allowed).
    const tag = ['nav', 'main', 'footer', 'aside'].includes(raw) ? 'div' : raw;
    const cs = getComputedStyle(el);
    // Full-width detection (this viewport): a block filling its parent's content box with ~0 side margins
    // was width:100%/auto → emit w-full (fluid), not a pinned px width.
    let fullW = false; const par = el.parentElement;
    if (par && pcs) {
      const pcw = par.clientWidth - parseFloat(pcs.paddingLeft || '0') - parseFloat(pcs.paddingRight || '0');
      const ml = parseFloat(cs.marginLeft || '0'), mr = parseFloat(cs.marginRight || '0');
      if (pcw > 0 && Math.abs(ml) < 1 && Math.abs(mr) < 1 && el.getBoundingClientRect().width >= pcw - 2) fullW = true;
    }
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/\s+/g, ' ').trim();
    const s = {};
    for (const k of INH) { const v = cs.getPropertyValue(k); if (v && (own || !pcs || v !== pcs.getPropertyValue(k))) s[k] = v; }
    for (const k in BOX) { const v = cs.getPropertyValue(k); if (v && v !== BOX[k]) s[k] = v; }
    if (fullW) s.width = '100%';
    // Lock SHORT single-line text as nowrap (this viewport): one line by design, often relying on a
    // condensed web font; a fallback font would wrap it. Short cap so real prose can still wrap.
    if (own && own.length < 25) { const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2; if (lh > 0 && el.getBoundingClientRect().height <= lh * 1.4) s['white-space'] = 'nowrap'; }
    for (const sd of ['top', 'right', 'bottom', 'left']) { if (s[`border-${sd}-width`]) { s[`border-${sd}-style`] = cs.getPropertyValue(`border-${sd}-style`); s[`border-${sd}-color`] = cs.getPropertyValue(`border-${sd}-color`); } }
    if (own) { delete s.width; delete s.height; }
    const node = { tag, s, children: [], text: own };
    // A flex child defaults to min-width:auto → a fixed/large child won't shrink + overflows a narrow row.
    // Mark it so we emit min-w-0 (the standard flex-overflow fix).
    node.pflex = !!(pcs && /flex/.test(pcs.display));
    // MOTION: scroll-reveal (WOW/animate.css/AOS) is JS-driven + stripped. Capture the computed animation
    // (keyframe + delay + duration) → re-expressed as data-aos. Fall back to the class for WOW elements
    // whose animation already finished by capture time (animationName resets to 'none').
    {
      const an = cs.animationName, acl = el.getAttribute('class') || '';
      const name = (an && an !== 'none') ? an : (acl.match(/\b(fadeIn\w*|slideIn\w*|zoomIn\w*|flipIn\w*|fadeOut\w*|zoomOut\w*)/i)?.[0] || null);
      if (name) node.anim = { name, delay: cs.animationDelay, dur: cs.animationDuration };
    }
    if (tag === 'img') { const cur = el.currentSrc || el.src; const r = (cur && !/^data:|\/1x1|blank|placeholder/.test(cur)) ? cur : (el.getAttribute('data-src') || el.getAttribute('data-original') || el.getAttribute('data-lazy-src') || cur || ''); try { node.src = r ? new URL(r, location.href).href : ''; } catch { node.src = r || ''; } node.alt = el.getAttribute('alt') || ''; }
    if (tag === 'a') node.href = el.getAttribute('href') || '';
    if (tag === 'i' || tag === 'span') { node.icon = el.getAttribute('class') || ''; if (/\bfa/.test(node.icon)) { node.iconSize = cs.fontSize; node.iconColor = cs.color; } } // FontAwesome → capture size+color
    if (tag === 'iframe') { node.src = el.src || el.getAttribute('src') || ''; node.title = el.getAttribute('title') || ''; s.height = cs.getPropertyValue('height'); }
    // ROTATING TILES (3D flip): the source marks the card `.flippable` + its hidden face `.back` (matrix3d
    // rotateY(180)). The flip mechanics are JS/CSS we strip → record them so emit() rebuilds a clean flip.
    { const acl = el.getAttribute('class') || ''; if (/\bflippable\b/.test(acl)) { node.flip = true; node.flipH = cs.getPropertyValue('height'); } if (/\bback\b/.test(acl) && /matrix3d/.test(cs.transform)) node.isBack = true; }
    for (const c of el.children) { const cn = walk(c, cs); if (cn) node.children.push(cn); }
    return node;
  }
  const root = document.querySelector(ROOT_SEL) || document.querySelector('#main-content') || document.querySelector('main') || document.body;
  return [...root.children].map((c) => walk(c, getComputedStyle(root))).filter(Boolean);
}

/**
 * Capture a nav's logo + link list (a nav is JS-interactive — a mechanical capture can't reproduce its
 * toggles/dropdowns; the orchestrator rebuilds a clean responsive DaisyUI navbar from this data instead).
 */
export function NAVDATA(sel) {
  const root = document.querySelector(sel) || document.body;
  const img = root.querySelector('img');
  const logo = img ? { src: img.currentSrc || img.src || '', alt: img.getAttribute('alt') || '' } : null;
  const seen = new Set(), links = [];
  for (const a of root.querySelectorAll('a')) {
    const text = a.textContent.replace(/\s+/g, ' ').trim();
    if (!text || text.length > 40 || a.querySelector('img')) continue; // skip the logo link + icon-only
    const key = text.toLowerCase(); if (seen.has(key)) continue; seen.add(key);
    links.push({ text, href: a.getAttribute('href') || '' });
  }
  return { logo, links };
}

/** Scroll through the page to trigger lazy-load + settle reveal animations, then return to the top. */
export async function SCROLL_SETTLE() {
  for (let y = 0; y <= document.body.scrollHeight; y += 400) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
  scrollTo(0, 0);
}
/* v8 ignore stop */
