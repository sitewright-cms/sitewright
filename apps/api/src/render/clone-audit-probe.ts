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

/**
 * FIXED-HEADER CLEARANCE at the current viewport. Returns null when there is nothing to judge: no
 * landmark, a header that is not fixed (it is in flow, so it cannot cover anything), or a landmark
 * measuring ~0 — which happens when the author's own bar INSIDE #main-nav is itself position:fixed, so
 * the landmark collapses and its height says nothing about the visible bar.
 *
 * Two numbers matter and they are different questions:
 *   • bar vs token   — is `--sw-header-h` telling the truth about how tall the bar is?
 *   • token vs spacer— did `.sw-top-padding` actually apply, or did another padding rule beat it?
 * The second exists because the spacer is a single-class rule in the platform base sheet and Tailwind's
 * utilities load after it: any `p-*`/`pt-*`/`py-*`, custom class or inline padding on the same element
 * wins on source order and the class contributes NOTHING, with nothing on screen to say so.
 */
export async function HEADER_PROBE() {
  const nav = document.getElementById('main-nav');
  const pc = document.getElementById('page-content');
  if (!nav || !pc) return null;
  if (getComputedStyle(nav).position !== 'fixed') return null;
  // ★ MEASURE AT REST. settlePage runs before this and does NOT leave the page at the top: its embed step
  // brings each visible iframe into view and dwells there, so on any page with a map or a video the probe
  // would otherwise run scrolled. That matters because a sticky header's SCROLLED state is a different
  // element: measured on a real page, the same bar was 91.1px scrolled at BOTH viewports while its at-rest
  // height is 66.8px at 390px and 102.8px at 1920px — the scrolled figure agreed with neither, and being
  // identical across two widths is exactly the tell that it was not the bar the page lays out against.
  // The at-rest height is the right one: `.sw-top-padding` and the #page-content offset are static CSS
  // resolved at the top of the document, and a bar that has changed height has already scrolled past the
  // content it would cover. Scrolling back also makes the viewport-relative text measurement below mean
  // something — while scrolled it reported firstTextTop of -773.
  // ★ RESET EVERY SCROLLER, not just the window. The whole-site preview shell scrolls the BODY
  // (html{overflow:hidden} there), so `scrollTo(0,0)` and `window.scrollY` are both INERT on that
  // surface — the first version of this reported scrollY 0 while the page was still 773px down, which
  // is the same body-scroller trap the sticky runtime already works around with a capture-phase
  // listener. Reset all three and read back whichever one actually moves.
  scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  // The sticky runtime clears `sw-scrolled` from a scroll event on a rAF, and its hysteresis releases at
  // y <= max(4, headerH/2), which 0 satisfies. Bounded so a page without the runtime cannot hang.
  for (let i = 0; i < 20 && document.documentElement.classList.contains('sw-scrolled'); i += 1) {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }
  // ★ …then wait for the HEIGHT to settle, which is NOT the same as the class being gone. A collapse is
  // author CSS with a transition, so the class flips one frame and the bar keeps moving for ~300ms after.
  // Measuring on the class alone caught the bar mid-flight and produced ~90px at BOTH viewports — from
  // opposite directions (at rest it is 66.8px at 390px and 102.8px at 1920px), which is the signature of
  // a value still travelling rather than a real measurement. Settle on the value, never on the trigger.
  let bar = nav.getBoundingClientRect().height;
  for (let stable = 0, i = 0; stable < 3 && i < 60; i += 1) {
    await new Promise((r) => requestAnimationFrame(r));
    const h = nav.getBoundingClientRect().height;
    stable = Math.abs(h - bar) < 0.05 ? stable + 1 : 0;
    bar = h;
  }
  if (!(bar > 1)) return null;
  const r1 = (n) => Math.round(n * 10) / 10;
  // MEASURE the token rather than parse it: it is authored in rem, px or calc(), and only layout knows
  // what those resolve to at this viewport.
  const ruler = document.createElement('div');
  ruler.style.cssText = 'position:absolute;visibility:hidden;height:var(--sw-header-h)';
  pc.appendChild(ruler);
  const token = ruler.getBoundingClientRect().height;
  ruler.remove();
  const spacer = pc.querySelector('.sw-top-padding');
  const spacerPad = spacer ? parseFloat(getComputedStyle(spacer).paddingTop) || 0 : null;
  // The topmost PAINTED text. Screen-reader-only headings (clip-path:inset(50%), a 1x1 box) sit at the
  // top of nearly every imported page, so a naive "is any text under the bar" test reports a defect on
  // essentially every site — measured, 5 of 6 candidate findings in a 45-site census were exactly this.
  let firstTextTop = null;
  let firstText = '';
  const walk = document.createTreeWalker(pc, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (!n.nodeValue || !n.nodeValue.trim()) continue;
    const el = n.parentElement;
    if (!el) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue;
    if (cs.clipPath && cs.clipPath !== 'none') continue;
    const r = el.getBoundingClientRect();
    if (r.height < 8 || r.width < 8) continue;
    if (firstTextTop === null || r.top < firstTextTop) { firstTextTop = r.top; firstText = n.nodeValue.trim().slice(0, 60); }
  }
  return {
    bar: r1(bar),
    token: r1(token),
    spacerPad: spacerPad === null ? null : r1(spacerPad),
    spacerClass: spacer ? String(spacer.className || '').slice(0, 120) : null,
    firstTextTop: firstTextTop === null ? null : r1(firstTextTop),
    firstText,
    // Diagnostic: the EFFECTIVE scroll offset across all three scrollers. Non-zero means the unscroll
    // did not take, so `bar` may be the scrolled height and the numbers should not be trusted.
    scrollYAtMeasure: r1(Math.max(window.scrollY || 0, document.documentElement.scrollTop || 0, document.body.scrollTop || 0)),
  };
}
/* v8 ignore stop */
