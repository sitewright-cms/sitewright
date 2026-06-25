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
    // Drop a data:-URI background — it's a lazy-load SPINNER / tiny decorative pattern, never real content;
    // emitting it bloats the source and (for a not-yet-loaded lazy element) paints a stray placeholder band.
    if (s['background-image'] && /url\(\s*["']?data:/i.test(s['background-image'])) delete s['background-image'];
    if (fullW) s.width = '100%';
    // Lock SHORT single-line text as nowrap (this viewport): one line by design, often relying on a
    // condensed web font; a fallback font would wrap it. Short cap so real prose can still wrap.
    if (own && own.length < 25) { const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2; if (lh > 0 && el.getBoundingClientRect().height <= lh * 1.4) s['white-space'] = 'nowrap'; }
    for (const sd of ['top', 'right', 'bottom', 'left']) { if (s[`border-${sd}-width`]) { s[`border-${sd}-style`] = cs.getPropertyValue(`border-${sd}-style`); s[`border-${sd}-color`] = cs.getPropertyValue(`border-${sd}-color`); } }
    if (own) { delete s.width; delete s.height; }
    // INLINE TEXT BLOCK: an element with its OWN text AND only inline-formatting children (<b>/<i>/<span>…
    // — no link/img/media/block descendant) → capture the FULL textContent IN ORDER and DON'T recurse, so
    // an inline <b>/<span> isn't torn out of the sentence and appended at the end (which dropped spaces and
    // reordered rich paragraphs, e.g. burmeister social-investment: "a bigger .We recognize…people.We").
    let flatText = '';
    {
      const kids = [...el.children];
      if (own && kids.length > 0 && kids.every((c) => {
        const d = getComputedStyle(c).display;
        return (d === 'inline' || d === 'inline-block') && !/^(A|IMG|BUTTON|SVG|IFRAME|VIDEO|INPUT|SELECT|CANVAS|OBJECT)$/.test(c.tagName) && !c.querySelector('a[href],img,svg,button,iframe,video');
      })) flatText = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim(); // innerText keeps <br>/line breaks as spaces (textContent drops them → run-on sentences)
    }
    const node = { tag, s, children: [], text: flatText || own };
    // CONTENT CONTAINER hint: a foreign `.container` / content-wrapper class is the most reliable signal of
    // a centered max-width wrapper (the computed cap is unreliable — it depends on a media query firing at
    // the capture width AND on the foreign CSS not colliding with the platform's own `.container`).
    { const acl = el.getAttribute('class') || ''; if (/(^|\s)(container|content-wrapper|content-container|page-container|site-container|inner-wrap|content-wrap)(\s|$)/i.test(acl)) node.containerHint = true; }
    // FOLD: an element starting past the first viewport-height (absolute doc position) can lazy-load its
    // image/background; an above-the-fold one stays eager (LCP). Robust to any scroll position at walk time.
    node.belowFold = (el.getBoundingClientRect().top + window.scrollY) > window.innerHeight;
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
    if (tag === 'iframe') { node.src = el.src || el.getAttribute('src') || el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || ''; node.title = el.getAttribute('title') || ''; s.height = cs.getPropertyValue('height'); }
    // ROTATING TILES (3D flip): the source marks the card `.flippable` + its hidden face `.back` (matrix3d
    // rotateY(180)). The flip mechanics are JS/CSS we strip → record them so emit() rebuilds a clean flip.
    { const acl = el.getAttribute('class') || ''; if (/\bflippable\b/.test(acl)) { node.flip = true; node.flipH = cs.getPropertyValue('height'); } if (/\bback\b/.test(acl) && /matrix3d/.test(cs.transform)) node.isBack = true; }
    // MODAL: a Bootstrap/MDB modal CONTAINER (class "modal" — not the inner modal-* parts — or role=dialog,
    // with an id) → snap to <dialog data-sw-component="modal">. A TRIGGER (data-(bs-)toggle="modal") records
    // the referenced modal id so emit() wires it (href="#id" / data-sw-modal). Attrs survive import (only
    // scripts are stripped), and the hidden modal subtree is still walked (display:none, not skipped).
    {
      const acl = el.getAttribute('class') || ''; const id = el.getAttribute('id') || '';
      // "modal" as a whole token OR a SUFFIX (cb-modal, my-modal) — but NOT a prefix (modal-content/-dialog
      // /-backdrop are the inner Bootstrap parts): match `modal` ending a token (end-or-space, never a hyphen).
      if (id && (/(?:^|[\s_-])modal(?:$|\s)/i.test(acl) || el.getAttribute('role') === 'dialog')) { node.isModal = true; node.id = id; }
      const tgl = el.getAttribute('data-toggle') || el.getAttribute('data-bs-toggle') || '';
      if (tgl === 'modal') { const t = el.getAttribute('data-target') || el.getAttribute('data-bs-target') || el.getAttribute('href') || ''; const m = t.match(/^#(.+)$/); if (m) node.modalTarget = m[1]; }
    }
    // CAROUSEL / TABS / ACCORDION → platform components, recognized from STATIC author markup (class
    // markers + the slide/panel structure survive import; Bootstrap/Swiper write these in HTML, pre-JS).
    {
      const acl = el.getAttribute('class') || '';
      if (/(^|\s)(carousel|swiper|swiper-container)(\s|$)/.test(acl) && el.querySelector('.carousel-item,.swiper-slide,.carousel-inner,.swiper-wrapper')) node.snap = 'carousel';
      // owl / slick / any *-slider|*-carousel container whose slides are DIRECT children (the lib adds the
      // wrapper/slide classes at RUNTIME). Detected by .owl-carousel / data-slick, OR a *-slider|*-carousel
      // class with ≥2 `.slide` children (e.g. burmeister `cb-slider` → 19 `.slide`s; without this the slick
      // slides render as stacked static divs instead of one carousel).
      else if ((/(^|\s)owl-carousel(\s|$)/.test(acl) || el.hasAttribute('data-slick') || (/(^|\s)[\w-]*(?:slider|carousel)(\s|$)/i.test(acl) && [...el.children].filter((c) => /(^|\s)slide(\s|$)/.test(c.getAttribute('class') || '')).length >= 2)) && el.children.length >= 2) node.snap = 'carousel-direct';
      else if (/(^|\s)(carousel-inner|swiper-wrapper)(\s|$)/.test(acl)) node.snap = 'carousel-track';
      else if (/(^|\s)(carousel-item|swiper-slide)(\s|$)/.test(acl)) node.snap = 'carousel-slide';
      else if (/(^|\s)tab-content(\s|$)/.test(acl) && el.querySelector('.tab-pane')) node.snap = 'tabs';
      else if (/(^|\s)(nav-tabs|nav-pills)(\s|$)/.test(acl)) node.snap = 'drop'; // the source tab buttons — runtime rebuilds them
      else if (/(^|\s)tab-pane(\s|$)/.test(acl)) {
        node.snap = 'tab-panel';
        const tid = el.getAttribute('id') || ''; let t = '';
        if (tid) { try { const btn = document.querySelector('[href="#' + tid + '"],[data-bs-target="#' + tid + '"],[aria-controls="' + tid + '"]'); if (btn) t = (btn.textContent || '').replace(/\s+/g, ' ').trim(); } catch { /* odd id → fall back */ } }
        node.tabTitle = t || 'Tab';
      } else if (/(^|\s)accordion-item(\s|$)/.test(acl)) node.snap = 'details';
      else if (/(^|\s)(accordion-header|accordion-collapse)(\s|$)/.test(acl)) node.snap = 'unwrap'; // remove the wrapper so <summary>/body are direct children of <details>
      else if (/(^|\s)accordion-button(\s|$)/.test(acl)) node.snap = 'summary';
    }
    if (!flatText) for (const c of el.children) { const cn = walk(c, cs); if (cn) node.children.push(cn); }
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

/** The document BODY's own computed background (the page background) — WALK(body) only sees its children,
 *  never the body itself; the orchestrator applies this site-wide via criticalCss. */
export function BODYBG() {
  const cs = getComputedStyle(document.body);
  const hs = getComputedStyle(document.documentElement);
  const fam = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).fontFamily : ''; };
  return { image: cs.backgroundImage, color: cs.backgroundColor, htmlColor: hs.backgroundColor, size: cs.backgroundSize, position: cs.backgroundPosition, repeat: cs.backgroundRepeat, attachment: cs.backgroundAttachment, bodyFont: cs.fontFamily, headingFont: fam('h1,h2,h3,.h1,.h2') || cs.fontFamily };
}

/** Scroll through the page to trigger lazy-load + settle reveal animations, then return to the top. */
export async function SCROLL_SETTLE() {
  for (let y = 0; y <= document.body.scrollHeight; y += 400) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
  scrollTo(0, 0);
}
/* v8 ignore stop */
