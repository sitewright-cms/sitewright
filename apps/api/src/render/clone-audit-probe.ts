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
  const isSystem = (f) => !f || /^(sans-serif|serif|monospace|system-ui|ui-|-apple-|-webkit-|inherit|initial)/i.test(f);
  // document.fonts is a FontFaceSet (setlike, iterable — NOT array-like), so materialise it before .some.
  const loaded = (f) => isSystem(f) || Array.from(document.fonts).some((ff) => ff.family.replace(/["']/g, '') === f && ff.status === 'loaded');
  return { carousels: cars.length, carouselsEnhanced, dialogs, headingFont, bodyFont, headingFontLoaded: loaded(headingFont), bodyFontLoaded: loaded(bodyFont) };
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
