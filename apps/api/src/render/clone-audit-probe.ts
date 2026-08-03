// @ts-nocheck
/* v8 ignore start -- browser code, runs via page.evaluate in Chromium (not under node coverage) */
// Browser-side probes for clone_audit's BEHAVIOUR leg. These run in the page (like fidelity-extract.ts),
// so they use DOM globals and stay untyped. The rigorous font check keys on a LOADED FontFace (NOT
// document.fonts.check, which false-negatives against the preview's duplicate @font-face registrations).

/** Desktop behaviour facts of the current BUILD render. */
export function BEHAVIOUR_PROBE() {
  const cars = Array.prototype.slice.call(document.querySelectorAll('[data-sw-component="carousel"]'));
  const carouselsEnhanced = cars.filter((c) => c.getAttribute('data-sw-enhanced') === 'true').length;
  const dialogs = document.querySelectorAll('dialog,[data-sw-component="modal"]').length;
  const famOf = (varName, fallbackSel) => {
    let v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    if (!v) v = getComputedStyle(document.querySelector(fallbackSel) || document.body).fontFamily;
    return (v.split(',')[0] || '').replace(/["']/g, '').trim();
  };
  const headingFont = famOf('--sw-font-heading', 'h1,h2,h3');
  const bodyFont = famOf('--sw-font-body', 'body');
  // document.fonts is a FontFaceSet (setlike, iterable — NOT array-like), so materialise it before .some.
  const faces = Array.from(document.fonts);
  const norm = (s) => (s || '').replace(/["']/g, '').trim().toLowerCase();
  const declared = (f) => faces.some((ff) => norm(ff.family) === norm(f));
  // A family NO @font-face declares is a SYSTEM face — there is nothing to load, so it cannot be MISSING.
  // This used to be a name test (`/^(sans-serif|serif|monospace|ui-|…)/`) that only recognised the GENERIC
  // keywords, so every NAMED system face failed the gate: Verdana, Georgia, Times New Roman, Arial and the
  // rest. The platform offers exactly those (FontSlotEditor's web-safe group), the importer WRITES them
  // (a source declaring `@font-face{font-family:"text-font";src:local("Verdana")}` becomes
  // `{source:'system', family:'Verdana'}`) and the agent guide instructs agents to use them — and then this
  // check called the result a missing font. An agent's only way out was a webfont the original never had.
  // Note `document.fonts.check()` cannot do this job: measured in the render container it returns TRUE for
  // any family that isn't a registered-and-failed @font-face, including ones nothing can render.
  // The converse gap — a webfont NAME with no @font-face behind it — is unreachable through the platform's
  // renderer, which emits a slot's family and its @font-face from the same source (typography-css).
  const kind = (f) => (!f || !declared(f) ? 'system' : faces.some((ff) => norm(ff.family) === norm(f) && ff.status === 'loaded') ? 'loaded' : 'missing');
  const loaded = (f) => kind(f) !== 'missing';
  return {
    carousels: cars.length, carouselsEnhanced, dialogs, headingFont, bodyFont,
    headingFontLoaded: loaded(headingFont), bodyFontLoaded: loaded(bodyFont),
    // Reported so the check's DETAIL can say "system" rather than "loaded" for a face there was never
    // anything to load for — the pass is the same, the sentence an agent reads is not.
    headingFontKind: kind(headingFont), bodyFontKind: kind(bodyFont),
  };
}

// Each probe MUST be self-contained (no module-scope refs) — page.evaluate serialises only the function
// body, so a shared helper would be a ReferenceError in the page. `vis` is therefore inlined in each.

/** Count the site-header nav links currently reachable (visible + real text). */
export function NAV_COUNT() {
  const vis = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const c = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && c.display !== 'none' && c.visibility !== 'hidden';
  };
  return Array.prototype.filter.call(document.querySelectorAll('#main-nav a'), (a) => vis(a) && (a.textContent || '').trim().length > 1).length;
}

/**
 * Elements VISUALLY CUT OFF by an ancestor's overflow — the check a rect measurement cannot make.
 *
 * getBoundingClientRect reports the LAYOUT box whether or not an ancestor clips it, so "is this cut
 * off?" is invisible to every measurement an agent naturally reaches for: the element reports its full
 * size while the visitor sees half of it. Both a platform agent and a human reviewer have shipped this
 * defect while holding a measurement that looked correct. It is also invisible in the authored source
 * when the clipper is INJECTED by a component runtime (e.g. the carousel's [data-sw-part="container"]).
 *
 * So: walk each candidate's ancestors, intersect with every clipping ancestor, and report what actually
 * survives. Images and text leaves only, node-capped, and reporting the CLIPPER so the fix is obvious.
 *
 * TWO KINDS OF CLIPPING ARE DELIBERATE and must never be reported, because flagging them pushes authors
 * to break working markup to satisfy the gate:
 *   • a SLIDER viewport — queued slides live outside it; a "peek" carousel shows a sliver on purpose;
 *   • a total (>95%) clip — a collapsed accordion, a closed drawer, an off-screen panel. The visitor
 *     sees nothing rather than something chopped, so there is no visual defect.
 * Only a PARTIAL cut of a normally-flowing element is a real finding.
 */
export function CLIP_PROBE() {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const c = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && c.display !== 'none' && c.visibility !== 'hidden' && +c.opacity > 0.05;
  };
  const label = (el) => {
    const cls = (el.className || '').toString().trim().split(/\s+/).slice(0, 2).join('.');
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls ? '.' + cls : '');
  };
  // Images carry the most visible failures; text leaves catch a clipped heading/caption.
  const nodes = Array.prototype.slice.call(document.querySelectorAll('img,svg,picture,video,h1,h2,h3,p,figcaption')).slice(0, 400);
  // A slider viewport's ENTIRE JOB is to clip: the queued slides sit outside it, and a "peek" carousel
  // deliberately shows a sliver of the next one. The probe cannot tell by-design queuing from a defect
  // in there, and guessing wrong is expensive — a false positive here pushed a real clone to replace 14
  // `<img alt>` elements with CSS background divs (alt text and srcset gone) purely to pass this gate.
  const SLIDER = '[data-sw-part="container"],[data-sw-part="viewport"],[data-sw-component="carousel"],' +
    '.embla,.embla__viewport,.slick-list,.swiper,.swiper-wrapper,.glide__track,.flickity-viewport';
  const out = [];
  for (const el of nodes) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.height < 8 || r.width < 8) continue;
    let top = r.top, bottom = r.bottom, left = r.left, right = r.right, clipper = null, bySlider = false;
    let p = el.parentElement;
    while (p && p !== document.documentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const pr = p.getBoundingClientRect();
        if (pr.top > top || pr.bottom < bottom || pr.left > left || pr.right < right) {
          clipper = clipper || label(p);
          if (p.matches && p.matches(SLIDER)) bySlider = true;
        }
        top = Math.max(top, pr.top); bottom = Math.min(bottom, pr.bottom);
        left = Math.max(left, pr.left); right = Math.min(right, pr.right);
      }
      p = p.parentElement;
    }
    if (bySlider) continue;
    const visH = Math.max(0, bottom - top), visW = Math.max(0, right - left);
    // >10% of either axis eaten = a real visual cut, not a rounding artefact or a deliberate 1px crop.
    const lostH = 1 - visH / r.height, lostW = 1 - visW / r.width;
    // ...but something clipped to NOTHING is hidden ON PURPOSE — a collapsed accordion caption
    // (`max-width:0;overflow:hidden`, which is what the animation is), an off-screen slide, a closed
    // drawer. The visitor sees no half-drawn element, so there is no visual defect to report. Only a
    // PARTIAL cut means "the visitor can see this, and it is chopped".
    if (Math.max(lostH, lostW) > 0.95) continue;
    if (clipper && (lostH > 0.1 || lostW > 0.1)) {
      out.push({
        el: label(el),
        clippedBy: clipper,
        box: Math.round(r.width) + 'x' + Math.round(r.height),
        visible: Math.round(visW) + 'x' + Math.round(visH),
        lost: Math.round(Math.max(lostH, lostW) * 100) + '%',
        // Emitted so the ORIGINAL's clipping can be subtracted from the clone's. A native port has
        // different markup, so selectors cannot be paired across the two renders — but "an IMG cut
        // horizontally" is a design decision that survives the rewrite, and that is what pairs.
        tag: el.tagName.toLowerCase(),
        axis: lostW > lostH ? 'x' : 'y',
      });
    }
    if (out.length >= 12) break;
  }
  return out;
}

/** Click the first visible menu toggle inside the header (hamburger/label/button). Returns whether one was found. */
export function NAV_TOGGLE() {
  const vis = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const c = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && c.display !== 'none' && c.visibility !== 'hidden';
  };
  const t = Array.prototype.filter.call(
    document.querySelectorAll('#main-nav label[for], #main-nav button, #main-nav [class*="burger" i], #main-nav [class*="hamburger" i], #main-nav [aria-label*="menu" i]'),
    vis,
  )[0];
  if (t) { t.click(); return true; }
  return false;
}
/* v8 ignore stop */
